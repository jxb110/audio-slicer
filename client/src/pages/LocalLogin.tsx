import { trpc } from "@/lib/trpc";
import loginReference from "@/templates/login-reference.html?raw";
import { FormEvent, useEffect, useMemo, useRef } from "react";
import { setLocalSessionToken } from "@/lib/localSession";

type LoginMessage = {
  type: "audio-slicer-login";
  username: string;
  password: string;
};

function injectLoginBridge(html: string) {
  const bridge = `
    <script>
      (() => {
        const form = document.querySelector('.login-form form');
        const username = document.getElementById('username');
        const password = document.getElementById('password');
        const error = document.createElement('p');
        error.id = 'login-error';
        error.style.cssText = 'display:none;margin:12px 0 0;color:#ffaaa1;font-size:12px;text-align:center;line-height:1.5';
        form.appendChild(error);
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          error.style.display = 'none';
          window.parent.postMessage({ type: 'audio-slicer-login', username: username.value, password: password.value }, '*');
        });
        const hit = document.querySelector('.lamp__hit');
        const workspaceBrand = document.querySelector('.workspace-brand');
        const workspaceStatus = document.querySelector('#workspaceStatus');
        let pullStartY = null;
        let lampOn = false;
        let audioContext = null;
        const unlockAudio = () => {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (!AudioContextClass) return;
          if (!audioContext) audioContext = new AudioContextClass();
          if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
        };
        const playFallbackTone = () => {
          if (!audioContext || audioContext.state !== 'running') return;
          const now = audioContext.currentTime;
          const oscillator = audioContext.createOscillator();
          const gain = audioContext.createGain();
          oscillator.type = 'sine';
          oscillator.frequency.setValueAtTime(lampOn ? 720 : 440, now);
          oscillator.frequency.exponentialRampToValueAtTime(lampOn ? 980 : 300, now + 0.95);
          gain.gain.setValueAtTime(0.0001, now);
          gain.gain.exponentialRampToValueAtTime(0.09, now + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.98);
          oscillator.connect(gain).connect(audioContext.destination);
          oscillator.start(now);
          oscillator.stop(now + 1);
        };
        const playLampSound = () => {
          // 原始网页的远程MP3会受到浏览器自动播放、跨域和音频设备休眠影响。
          // 这里在同一拉线手势内直接播放1秒合成提示音，避免依赖外部播放状态。
          unlockAudio();
          playFallbackTone();
        };
        const toggleLamp = () => {
          lampOn = !lampOn;
          document.documentElement.style.setProperty('--on', lampOn ? '1' : '0');
          form.closest('.login-form').classList.toggle('active', lampOn);
          workspaceBrand.classList.toggle('lamp-on', lampOn);
          workspaceStatus.textContent = lampOn ? 'WORKSPACE READY' : 'PULL THE CORD';
          playLampSound();
        };
        hit.addEventListener('pointerdown', (event) => {
          // 必须在真实用户手势阶段解锁，避免静默环境下被浏览器自动播放策略拦截。
          unlockAudio();
          pullStartY = event.clientY;
          hit.setPointerCapture?.(event.pointerId);
        });
        hit.addEventListener('pointerup', (event) => {
          if (pullStartY !== null && event.clientY - pullStartY > 50) toggleLamp();
          pullStartY = null;
        });
        window.addEventListener('message', (event) => {
          if (event.data?.type === 'audio-slicer-login-error') {
            error.textContent = event.data.message || '登录失败，请检查账号与密码';
            error.style.display = 'block';
          }
        });
      })();
    <\/script>`;
  return html.replace("</body>", `${bridge}</body>`);
}

export default function LocalLogin() {
  const utils = trpc.useUtils();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const login = trpc.auth.login.useMutation({
    onSuccess: async result => {
      setLocalSessionToken(result.sessionToken);
      utils.auth.me.setData(undefined, result.user);
      await utils.auth.me.invalidate();
    },
  });
  const srcDoc = useMemo(() => injectLoginBridge(loginReference), []);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent<LoginMessage>) => {
      if (event.data?.type !== "audio-slicer-login") return;
      try {
        await login.mutateAsync({ username: event.data.username, password: event.data.password });
      } catch (error) {
        iframeRef.current?.contentWindow?.postMessage({
          type: "audio-slicer-login-error",
          message: error instanceof Error ? error.message : "登录失败，请检查账号与密码",
        }, "*");
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [login]);

  return (
    <main className="min-h-screen bg-[#121921]">
      <iframe
        ref={iframeRef}
        title="Audio Slicer 登录"
        srcDoc={srcDoc}
        sandbox="allow-scripts allow-forms allow-same-origin"
        className="h-screen w-full border-0"
      />
    </main>
  );
}
