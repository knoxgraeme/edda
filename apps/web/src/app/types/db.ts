/**
 * Re-exported DB types for use in client components.
 *
 * Client components can't import from @edda/db directly (architecture rule).
 * Server components import from @edda/db and pass data as props;
 * client components use these type aliases for prop typing.
 */

export type { Item, DashboardData, Settings, PendingItem, Entity, EntityType } from "@edda/db";
