import { trpc } from "@/lib/trpc";
import loginReference from "@/templates/login-reference.html?raw";
import { FormEvent, useEffect, useMemo, useRef } from "react";

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
        const revealLogin = () => {
          document.documentElement.style.setProperty('--on', '1');
          form.closest('.login-form').classList.add('active');
          workspaceBrand.classList.add('lamp-on');
          workspaceStatus.textContent = 'WORKSPACE READY';
        };
        hit.addEventListener('pointerdown', (event) => {
          pullStartY = event.clientY;
          hit.setPointerCapture?.(event.pointerId);
        });
        hit.addEventListener('pointerup', (event) => {
          if (pullStartY !== null && event.clientY - pullStartY > 50) revealLogin();
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
    onSuccess: async user => {
      utils.auth.me.setData(undefined, user);
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
