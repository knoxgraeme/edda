"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { MessageSquare, LayoutDashboard, Inbox, Users, Bot, Puzzle, Settings } from "lucide-react";

const navItems = [
  { href: "/", label: "Chat", icon: MessageSquare },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/entities", label: "Entities", icon: Users },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/skills", label: "Skills & Tools", icon: Puzzle },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function SideNav() {
  const pathname = usePathname();

  return (
    <nav className="flex h-screen w-14 flex-col items-center border-r border-border bg-muted/30 py-4 gap-1">
      <div className="mb-4 text-lg font-bold text-primary">E</div>
      {navItems.map(({ href, label, icon: Icon }) => {
        const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            title={label}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon size={20} />
          </Link>
        );
      })}
    </nav>
  );
}
