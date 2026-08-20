import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import AdminConsole from "./pages/AdminConsole";
import LocalLogin from "./pages/LocalLogin";
import { useAuth } from "./_core/hooks/useAuth";

function AuthenticatedHome() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-slate-950 text-slate-400 flex items-center justify-center font-mono text-sm">正在恢复本地会话...</div>;
  if (!user) return <LocalLogin />;
  return user.role === "admin" ? <AdminConsole /> : <Home />;
}

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/"} component={AuthenticatedHome} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable (light mode for tool aesthetic)
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
