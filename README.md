Sweet by André
Custom full-stack e-commerce platform for a bakery in Texas.
Status: 🚧 Active development — storefront, guest cart, and pending-order creation implemented; payment checkout and production deployment are not yet complete.

Overview
Sweet by André is a custom bakery e-commerce application designed to let customers explore products, choose options and quantities, add special instructions, and place scheduled orders. The project includes a customer-facing React storefront and a Node.js REST API backed by PostgreSQL.

The platform is being developed with an emphasis on maintainable code, secure transactions, data integrity, and reliable inventory management.
Tech Stack
Layer	Technologies
Frontend	React, Vite, Tailwind CSS
Backend	Node.js, Express.js, REST APIs
Database	PostgreSQL, pg connection pool
Authentication	Express sessions, PostgreSQL-backed session storage, HTTP-only cookies
Payments	Stripe Checkout and signed webhooks (integration in progress)
Testing	Node.js built-in test runner (node:test), API testing with Postman
Deployment	Planned; production hosting not yet finalized


Features
Storefront and catalog
- Browse bakery products and categories.
- View product details, available variants, prices, and stock.
- Choose product options, quantities, and item-specific notes.
- Responsive customer-facing interface.
Shopping cart
- Guest shopping cart without mandatory registration.
- Persistent cart identified by a secure HTTP-only cookie.
- Add items, adjust quantities, and remove items.
- Keep separate cart lines for the same variant when their notes differ.
- Detect changed prices and unavailable products.
- Update the cart badge in the header without a page reload.
Accounts and administration
- Session-based authentication and protected endpoints.
- CSRF protection for cart mutations.
- Administrative workflows for products, categories, options, variants, and images.
Orders
- Create pending orders for guest customers.
- Validate requested delivery dates (currently a provisional minimum of 48 hours).
- Calculate prices from current product variants on the server.
- Preserve order-item snapshots, including product name, selected options, unit price, and notes.
- Keep the cart intact while payment is pending.
Inventory and payment reliability — in progress
- Database-backed inventory reservation model.
- Transactional reservations with row-level locking.
- Checks for insufficient stock and duplicate reservations.
- Persistent checkout-attempt records and unique Stripe payment identifiers.
- Stripe Checkout session coordination, reservation finalization, webhook reconciliation, and safe expiration handling are not yet complete.
Business rule: Customers will pay 100% of the order total at checkout. Partial deposits are not part of the planned payment flow.
Project Structure
sweet-by-andre/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── middleware/
│   │   ├── routes/
│   │   ├── services/
│   │   └── ...
│   ├── tests/
│   │   ├── testInventoryReservation.js
│   │   └── testInventoryConcurrency.js
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   └── services/
│   └── package.json
└── README.md
Structure abbreviated to highlight the main modules.
Local Development
Prerequisites
- Node.js (the project has been developed using Node.js 24)
- PostgreSQL
- npm
- Stripe test credentials when working on payment integrations
Backend
cd backend
npm install
npm run dev
The development API runs at http://localhost:5000 when configured with the project's current local settings.

Configure environment variables in backend/.env as appropriate for your local setup. Database configuration uses:
DB_HOST=localhost
DB_PORT=5432
DB_NAME=sweet_by_andre_dev
DB_USER=your_database_user
DB_PASSWORD=your_database_password
Additional session, CSRF, frontend-origin, and Stripe environment variables are required by their respective integrations. Never commit real credentials or .env files.
Frontend
cd frontend
npm install
npm run dev
The Vite development server runs at http://localhost:5173 and proxies /api requests to the backend.
A local PostgreSQL database with the project's current schema is required. Database migrations and repeatable setup scripts should be consolidated before the project is offered as a one-command installation.

Testing
The backend includes automated tests for inventory reservation behavior.

Reservation tests cover:
- Successful reservation of available units.
- Rejection when inventory is insufficient.
- Prevention of duplicate reservations for one order.
Concurrency test verifies that when two orders independently request 10 units from a stock of 15, only one reservation succeeds. Test fixtures are removed after the run.

The concurrency test requires an isolated PostgreSQL database named sweet_by_andre_test with the current schema and a dedicated .env.test configuration.
cd backend
node --env-file=.env.test --test ./tests/testInventoryConcurrency.js
The existing reservation tests have also passed against a known development fixture:
node --test ./tests/testInventoryReservation.js
Safety: The reservation tests currently reference an existing development order. They should be refactored to use self-contained fixtures in the isolated test database. Do not run destructive tests against production.

Current Progress
Area	Status
Express API and PostgreSQL setup	✅ Implemented
Product, category, and variant management	✅ Implemented
React storefront and product detail	✅ Implemented
Persistent guest cart and live header count	✅ Implemented
Session authentication and cart CSRF controls	✅ Implemented
Guest pending-order creation and item snapshots	✅ Implemented
Inventory reservation service	✅ Implemented and tested
Concurrent reservation test	✅ Passed
Checkout attempt persistence	✅ Database schema created
Stripe Checkout + inventory reservation integration	🚧 In progress
Payment webhook inventory finalization and recovery	🚧 In progress
Delivery rules, shipping fees, and tax calculations	📋 Pending final business rules
End-to-end checkout UI	📋 Pending
Production deployment	📋 Pending


Roadmap
- [x] Initialize project and establish backend architecture.
- [x] Configure PostgreSQL and database connectivity.
- [x] Build product, category, option, and variant APIs.
- [x] Implement session-based authentication and administrative product flows.
- [x] Build React storefront and guest shopping cart.
- [x] Add CSRF protection and synchronize cart updates across the interface.
- [x] Support guest pending orders with item snapshots.
- [x] Build and test transactional inventory reservations.
- [x] Add Stripe payment identifier constraints and checkout-attempt schema.
- [ ] Integrate inventory reservations and idempotent Stripe Checkout sessions.
- [ ] Finalize payment webhooks, stock commits, and safe reservation releases.
- [ ] Complete delivery scheduling rules, shipping, and tax calculations.
- [ ] Build and validate the end-to-end checkout experience.
- [ ] Add end-to-end and recovery scenario tests.
- [ ] Complete security review and deploy to production.
Engineering Principles
- Separation of concerns and maintainable modules.
- Server-side validation of prices, quantities, and stock.
- Transactional data integrity and concurrency control.
- Session security, HTTP-only cookies, and CSRF defenses.
- Payment idempotency and webhook verification.
- Automated regression tests for critical business logic.
Author
Developed by Miguel for Sweet by André.

This is an actively developed project. Features marked as in progress or pending are not production-ready.
