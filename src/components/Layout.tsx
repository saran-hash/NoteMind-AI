import { Link, useLocation } from 'react-router-dom';
import { BookOpen, MessageSquare, History, Settings, Sparkles, BrainCircuit } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { path: '/', label: 'Materials', icon: BookOpen },
  { path: '/ask', label: 'Tutor Chat', icon: MessageSquare },
  { path: '/study-lab', label: 'Study Lab', icon: Sparkles, isHighlight: true },
  { path: '/history', label: 'History', icon: History },
  { path: '/settings', label: 'Settings', icon: Settings },
];

export const Layout = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-purple-500/30 selection:text-purple-200">
      <header className="sticky top-0 z-50 border-b border-border/80 bg-card/80 backdrop-blur-md">
        <div className="container mx-auto px-4 py-3.5">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2.5 group">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-blue-500 flex items-center justify-center shadow-md shadow-purple-500/20 group-hover:scale-105 transition-transform duration-200">
                <BrainCircuit className="h-5 w-5 text-white" />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="text-lg font-bold bg-gradient-to-r from-purple-400 via-indigo-300 to-blue-400 bg-clip-text text-transparent">
                    NoteMind AI
                  </span>
                  <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    Pro
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground hidden sm:inline -mt-0.5">
                  Intelligent RAG Study Suite
                </span>
              </div>
            </Link>

            {/* Nav */}
            <nav className="flex items-center gap-1 sm:gap-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-sm font-medium transition-all duration-200',
                      isActive
                        ? item.isHighlight
                          ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-500/25'
                          : 'bg-primary text-primary-foreground shadow-sm'
                        : item.isHighlight
                        ? 'text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 border border-purple-500/20'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
                    )}
                  >
                    <Icon className={cn('h-4 w-4', item.isHighlight && !isActive && 'text-purple-400 animate-pulse')} />
                    <span className="hidden sm:inline">{item.label}</span>
                    {item.isHighlight && (
                      <span className="hidden md:inline-block text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-purple-500/30 text-purple-200 uppercase">
                        AI
                      </span>
                    )}
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
