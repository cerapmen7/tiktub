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
    <header className="sticky top-0 z-40 backdrop-blur-2xl bg-[#07070b]/70 border-b border-zinc-800/40 supports-[backdrop-filter]:bg-[#07070b]/60">
      <div className="absolute inset-0 bg-gradient-to-r from-violet-500/[0.02] via-transparent to-pink-500/[0.02] pointer-events-none" />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex h-[68px] items-center justify-between gap-4 relative">
        <Link to="/" className="flex items-center gap-3 group">
          <img src="/logo.svg" alt="TikTub" className="h-10 w-10 rounded-xl shadow-lg shadow-violet-600/20 group-hover:shadow-violet-600/30 group-hover:scale-[1.03] transition-all duration-300" />
          <div className="leading-none">
            <div className="font-extrabold text-[19px] tracking-tight font-display bg-gradient-to-r from-white via-violet-100 to-pink-100 bg-clip-text text-transparent">TikTub</div>
            <div className="text-[10px] font-semibold text-zinc-400 -mt-0.5 tracking-[0.14em] uppercase">TikTok → YouTube • PRO</div>
          </div>
          <span className="hidden sm:inline-flex ml-2 rounded-full bg-gradient-to-r from-violet-600 to-pink-500 px-2.5 py-1 text-[10px] font-bold tracking-widest uppercase text-white shadow-md shadow-violet-600/20">PRO • STUDIO</span>
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
