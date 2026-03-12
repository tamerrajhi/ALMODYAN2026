# Jewelry ERP System (المودان للمجوهرات)

## Overview
This project is an Arabic-language Enterprise Resource Planning (ERP) system tailored for the jewelry industry. It manages multi-branch operations, complex jewelry inventory, and financial transactions using a double-entry accounting system. Key features include ZATCA tax compliance for Saudi Arabia and comprehensive role-based access control. The system aims to provide an efficient, localized business solution within a modern Replit/Neon Postgres environment.

## User Preferences
- Arabic language is primary (RTL support)
- Saudi Riyal (SAR) as default currency
- 15% VAT rate for ZATCA compliance

## System Architecture
The system utilizes a full-stack JavaScript/TypeScript architecture. The backend, built with Node.js 20 and Express.js, provides API services to a React frontend. Data is persisted in Neon PostgreSQL, accessed via Drizzle ORM and `node-postgres`. The frontend leverages React, Vite, Tailwind CSS, and shadcn/ui, ensuring a responsive, modern, and fully Arabic user interface.

**Key Architectural Decisions:**
- **Atomic Write Policy:** All database write operations are enforced through atomic Remote Procedure Calls (RPCs) to guarantee data consistency, idempotency, and accurate accounting.
- **Database Schema:** A normalized database schema, comprising over 49 tables, manages inventory, accounting, transactions, purchasing, and security. The `unique_items` table is the single authoritative source for all inventory data.
- **API Design:** The system offers over 113 REST endpoints for CRUD operations, accounting postings, ZATCA validation, and system health checks. An RPC proxy enables secure calls to backend RPC functions, and dedicated join endpoints facilitate complex data aggregations.
- **Authentication:** Custom session-based authentication is implemented using HTTP-only cookies, SHA-256 token hashing, and bcryptjs for password verification.
- **POS as Separate App:** The Point of Sale (POS) operates as an independent application within the same project, with isolated routing, layout, session management, and permissions.
- **POS Data Gateway Pattern:** POS pages use `src/lib/posDataGateway.ts` for data access, routing through POS-specific endpoints that enforce `requireBranchSession` and `requirePosSession` for enhanced security and branch scoping.
- **Auth Page Structure:** The authentication page allows users to select between ERP login, POS admin login, or direct POS cashier access via branch selection and PIN.
- **POS Admin Dashboard:** An admin-only dashboard (`/pos/pos-dashboard`) provides key performance indicators and reports via dedicated API endpoints, supporting date range and branch/seller filtering.
- **POS Admin Flow:** POS administrators log in, then select a branch from a sidebar dropdown within the POS interface to access branch-specific operations.
- **Seller Auto-Determination:** The seller is automatically determined from the session context, linking cashiers or admins to their respective profiles for sales attribution.
- **UI/UX:** The frontend emphasizes a modern, responsive, and Arabic-first user experience, utilizing `rtl-mode` and responsive layout classes. Tables are designed for horizontal scrolling on smaller screens. Invoices are formatted for A4 printing and responsive screen display.
- **Role-Based Access Control (RBAC):** A unified access context endpoint provides comprehensive RBAC data.
- **ZATCA (Saudi Arabian Tax Authority):** Integrated for tax compliance within sales and accounting workflows.

## External Dependencies
- **Neon PostgreSQL:** Primary database.
- **Vite:** Frontend tooling.
- **Tailwind CSS:** Frontend styling.
- **shadcn/ui:** UI component library.
- **Supabase:** Used exclusively for Supabase Storage operations (file uploads and image management).