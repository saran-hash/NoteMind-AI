import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';

const navItems = [
  { path: '/', label: 'Materials' },
  { path: '/ask', label: 'Tutor Chat' },
  { path: '/study-lab', label: 'Study Lab' },
  { path: '/history', label: 'History' },
  { path: '/settings', label: 'Settings' },
];

export const Layout = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-slate-900 selection:text-white">
      <header className="sticky top-0 z-50 border-b border-border bg-white/95 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 group">
              <span className="h-8 w-8 rounded-lg bg-slate-900 text-white font-bold flex items-center justify-center text-sm">
                N
              </span>
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="text-base font-semibold text-slate-900 tracking-tight">
                    NoteMind
                  </span>
                  <span className="text-[10px] font-medium uppercase px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200">
                    AI
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground hidden sm:inline -mt-0.5">
                  AI Study Lab & Multi-Persona Tutor
                </span>
              </div>
            </Link>

            {/* Nav */}
            <nav className="flex items-center gap-1">
              {navItems.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    )}
                  >
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">{children}</main>
    </div>
  );
};
