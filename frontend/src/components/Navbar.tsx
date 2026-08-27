import { Link, useLocation } from "react-router-dom";
import { Film, LayoutDashboard, Settings, Wand2, Youtube } from "lucide-react";

export default function Navbar() {
  const { pathname } = useLocation();
  const isActive = (p: string) => pathname === p;

  const linkCls = (active: boolean) =>
    `inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition ${
      active ? "bg-violet-600 text-white shadow-lg shadow-violet-600/20" : "text-zinc-400 hover:text-white hover:bg-zinc-800"
    }`;

  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-[#0a0a0f]/80 border-b border-zinc-800/50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex h-[64px] items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-3 group">
          <div className="h-9 w-9 rounded-xl gradient-brand flex items-center justify-center shadow-lg shadow-violet-600/20 group-hover:shadow-violet-600/30 transition">
            <Film className="h-5 w-5 text-white" />
          </div>
          <div className="leading-none">
            <div className="font-extrabold text-lg tracking-tight">TikTub</div>
            <div className="text-[11px] font-medium text-zinc-400 -mt-0.5 tracking-widest uppercase">TikTok → YouTube</div>
          </div>
        </Link>

        <nav className="flex items-center gap-1.5 sm:gap-2">
          <Link to="/" className={linkCls(isActive("/"))}>
            <Wand2 className="h-4 w-4" />{" "}
            <span className="hidden sm:inline">Wizard</span>
          </Link>
          <Link to="/dashboard" className={linkCls(isActive("/dashboard"))}>
            <LayoutDashboard className="h-4 w-4" />{" "}
            <span className="hidden sm:inline">Dashboard</span>
          </Link>
          <Link to="/settings" className={linkCls(isActive("/settings"))}>
            <Settings className="h-4 w-4" />{" "}
            <span className="hidden sm:inline">Settings</span>
          </Link>
          <a
            href="https://youtube.com"
            target="_blank"
            rel="noreferrer"
            className="hidden md:inline-flex items-center gap-1.5 rounded-xl bg-red-600/10 border border-red-600/20 px-3 py-2 text-xs font-semibold text-red-400 hover:bg-red-600/20 transition"
          >
            <Youtube className="h-4 w-4" /> YouTube
          </a>
        </nav>
      </div>
    </header>
  );
}
