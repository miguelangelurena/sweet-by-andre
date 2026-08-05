# Sweet by Andre

Backend for the Sweet by Andre e-commerce platform.

> **Status:** 🚧 In Development

## Overview

Sweet by Andre is a custom e-commerce platform built for a bakery based in Texas.

The goal of this project is to create a modern, scalable, and maintainable web application where customers can:

- Browse bakery products.
- Place customized orders.
- Schedule pickups with a minimum notice period.
- Pay either a 50% deposit or the full amount.
- Receive a smooth and intuitive shopping experience.

This project is being built following industry best practices, with a focus on clean architecture, scalability, and long-term maintainability.

---

# Tech Stack

## Backend

- Node.js
- Express.js

## Database

- PostgreSQL

## Frontend

- Vanilla JavaScript

## Payments

- Stripe

## Deployment

- Railway

---

# Project Structure

```
backend/
│
├── src/
│   ├── config/
│   ├── controllers/
│   ├── routes/
│   ├── services/
│   ├── repositories/
│   ├── middleware/
│   ├── validators/
│   ├── utils/
│   └── app.js
│
├── server.js
├── package.json
└── .env
```

---

# Current Progress

## Sprint 0 ✅

- Project initialized
- Express configured
- PostgreSQL configured
- Connection Pool implemented
- Environment variables configured
- Initial folder architecture created
- First API endpoint (`GET /api/health`)
- Successful database connectivity test

---

# Planned Features

## Products

- Categories
- Seasonal products
- Product images
- Inventory management

## Shopping Cart

- Add / Remove products
- Quantity management
- Cart expiration

## Orders

- Pickup scheduling
- Minimum 2-day notice validation
- Order notes

## Payments

- 50% deposit
- Full payment
- Stripe integration

## Authentication

- Customer accounts
- Secure login
- JWT authentication

## Admin Dashboard

- Product management
- Order management
- Inventory control
- Category management

---

# Development Principles

This project follows a few core principles:

- Clean Architecture
- Separation of Concerns
- RESTful API Design
- Security First
- Scalable Database Design
- Maintainable Codebase

---

# Roadmap

- [x] Project setup
- [x] PostgreSQL configuration
- [x] Express architecture
- [x] Health endpoint
- [ ] Database schema design
- [ ] Products module
- [ ] Categories module
- [ ] Authentication
- [ ] Shopping cart
- [ ] Orders
- [ ] Stripe integration
- [ ] Admin dashboard
- [ ] Deployment

---

# Author

Developed by Miguel.

Project created for **Sweet by Andre**.
