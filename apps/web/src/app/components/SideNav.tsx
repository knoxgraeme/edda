"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Inbox,
  UserRound,
  Bot,
  Sparkles,
  Settings,
  Network,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const navGroups = [
  {
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/agents", label: "Agents", icon: Bot },
    ],
  },
  {
    items: [
      { href: "/inbox", label: "Inbox", icon: Inbox },
      { href: "/entities", label: "Entities", icon: UserRound },
      { href: "/graph", label: "Graph", icon: Network },
    ],
  },
  {
    items: [
      { href: "/skills", label: "Skills & Tools", icon: Sparkles },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function SideNav() {
  const pathname = usePathname();

  return (
    <TooltipProvider delayDuration={100}>
      <nav className="flex h-screen w-14 flex-col items-center gap-1 border-r border-border bg-background py-4">
        <div className="mb-4 font-mono text-[15px] font-semibold tracking-tight text-foreground">
          E
        </div>
        {navGroups.map((group, groupIndex) => (
          <div key={groupIndex} className="flex w-full flex-col items-center gap-1">
            {groupIndex > 0 && <div className="my-1.5 h-px w-6 bg-border" />}
            {group.items.map(({ href, label, icon: Icon }) => {
              const isActive =
                href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <Tooltip key={href}>
                  <TooltipTrigger asChild>
                    <Link
                      href={href}
                      className={cn(
                        "relative flex h-10 w-10 items-center justify-center rounded-md transition-colors",
                        isActive
                          ? "bg-accent-warm/10 text-accent-warm"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-accent-warm" />
                      )}
                      <Icon size={18} strokeWidth={1.75} />
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
