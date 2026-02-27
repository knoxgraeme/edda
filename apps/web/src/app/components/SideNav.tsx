"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Inbox, Users, Bot, Puzzle, Settings } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const navGroups = [
  {
    items: [
      { href: "/agents", label: "Agents", icon: Bot },
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    items: [
      { href: "/inbox", label: "Inbox", icon: Inbox },
      { href: "/entities", label: "Entities", icon: Users },
    ],
  },
  {
    items: [
      { href: "/skills", label: "Skills & Tools", icon: Puzzle },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function SideNav() {
  const pathname = usePathname();

  return (
    <TooltipProvider delayDuration={100}>
      <nav className="flex h-screen w-14 flex-col items-center border-r border-border bg-muted/30 py-4 gap-1">
        <div className="mb-4 text-lg font-bold text-primary">E</div>
        {navGroups.map((group, groupIndex) => (
          <div key={groupIndex} className="flex flex-col items-center gap-1 w-full">
            {groupIndex > 0 && (
              <div className="my-1.5 h-px w-6 bg-border" />
            )}
            {group.items.map(({ href, label, icon: Icon }) => {
              const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <Tooltip key={href}>
                  <TooltipTrigger asChild>
                    <Link
                      href={href}
                      className={cn(
                        "relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                        isActive
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-full bg-accent-warm" />
                      )}
                      <Icon size={20} />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={6}>
                    {label}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        ))}
      </nav>
    </TooltipProvider>
  );
}
