/** Permission catalogue. Roles are stored in the database and mapped to these keys. */
export const PERMISSIONS = {
  "admin.access": "Access the administration dashboard",
  "products.manage": "Create, edit and archive products, categories, brands and devices",
  "inventory.manage": "Adjust stock levels and view inventory reports",
  "orders.view": "View all customer orders",
  "orders.manage": "Update order fulfilment status and cancellations",
  "payments.manage": "Verify payments and process refunds",
  "customers.view": "View customer accounts",
  "customers.manage": "Manage customers, customer groups and wholesale approvals",
  "marketing.manage": "Manage coupons, discounts and reviews",
  "support.manage": "Handle support tickets and escalated conversations",
  "ai.manage": "Configure the AI assistant and knowledge base",
  "settings.manage": "Change store, payment, shipping and tax configuration",
  "audit.view": "View audit logs",
  "staff.manage": "Assign staff roles",
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
const ALL = Object.keys(PERMISSIONS) as PermissionKey[];

export const ROLE_KEYS = [
  "customer",
  "wholesale_customer",
  "support_agent",
  "inventory_manager",
  "warehouse_staff",
  "sales_manager",
  "marketing_manager",
  "finance_staff",
  "store_manager",
  "admin",
  "super_admin",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const SYSTEM_ROLES: Record<RoleKey, { name: string; description: string; isStaff: boolean; permissions: PermissionKey[] }> = {
  customer: { name: "Customer", description: "Retail customer", isStaff: false, permissions: [] },
  wholesale_customer: { name: "Wholesale customer", description: "Approved wholesale buyer", isStaff: false, permissions: [] },
  support_agent: {
    name: "Customer Support",
    description: "Handles customer service, orders and escalations",
    isStaff: true,
    permissions: ["admin.access", "orders.view", "customers.view", "support.manage"],
  },
  inventory_manager: {
    name: "Inventory manager",
    description: "Manages catalogue and stock",
    isStaff: true,
    permissions: ["admin.access", "products.manage", "inventory.manage", "orders.view"],
  },
  warehouse_staff: {
    name: "Warehouse staff",
    description: "Handles stock receiving, picking and warehouse operations",
    isStaff: true,
    permissions: ["admin.access", "inventory.manage", "orders.view"],
  },
  sales_manager: {
    name: "Sales manager",
    description: "Manages orders, customers and sales performance",
    isStaff: true,
    permissions: ["admin.access", "orders.view", "orders.manage", "customers.view", "customers.manage", "payments.manage", "audit.view"],
  },
  marketing_manager: {
    name: "Marketing manager",
    description: "Manages campaigns, coupons and customer engagement",
    isStaff: true,
    permissions: ["admin.access", "marketing.manage", "customers.view", "ai.manage"],
  },
  finance_staff: {
    name: "Finance staff",
    description: "Views payments, refunds and financial reports",
    isStaff: true,
    permissions: ["admin.access", "orders.view", "payments.manage", "audit.view"],
  },
  store_manager: {
    name: "Store manager",
    description: "Manages day-to-day store operations",
    isStaff: true,
    permissions: ["admin.access", "products.manage", "inventory.manage", "orders.view", "orders.manage", "customers.view", "customers.manage", "marketing.manage", "support.manage", "ai.manage", "audit.view"],
  },
  admin: {
    name: "Administrator",
    description: "Full store management",
    isStaff: true,
    permissions: ALL.filter((p) => p !== "staff.manage"),
  },
  super_admin: { name: "Super administrator", description: "Unrestricted access including staff roles", isStaff: true, permissions: ALL },
};
