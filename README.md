# BURIMA FL BACKEND

REST API for BURIMA FL, built with **Express.js + Mongoose** and scaffolded with **[calmapi](https://www.npmjs.com/package/calmapi) v0.2.5** (a modular REST API generator).

This project was derived from the BURIMA BACKEND codebase and currently ships only the **auth**, **user**, **category**, and **product** modules.

Each domain is a **module** under `src/modules/<name>/` and is auto-mounted at `/api/<plural-name>`. Modules follow calmapi's Controller → Service → Model architecture, so every module gets full CRUD (list with pagination/filter/sort, get, create, update, delete) from the `CalmController` / `CalmService` base classes.

## Requirements

- Node.js 18+ (tested on 24)
- MongoDB running locally (or set `MONGODB_URI`)

## Setup

```bash
npm install --legacy-peer-deps      # calmapi pins mongoose-unique-validator@4 (peer = mongoose 7)
npm start                           # starts on http://127.0.0.1:5001
# or, with auto-reload:
npm run dev
```

Configure the DB in `.env` (the committed value is a placeholder):

```
MONGODB_URI=mongodb://localhost:27017/burima-fl-backend
```

## Modules & endpoints

Base URL: `http://127.0.0.1:5001/api`

| Module    | Route               | Fields |
|-----------|---------------------|--------|
| Auth      | `/api/auth`         | JWT login / token handling |
| User      | `/api/users`        | `name`, `email`, `password`, `role`, … |
| Category  | `/api/categories`   | `name`, `slug`, `description`, `icon`, `status` |
| Product   | `/api/products`     | `name`, `code`, `category` (ref), `price`, `wholesalePrice`, `perCartonQty`, `minOrderQty`, `unit`, `status` |

Every CRUD module exposes:

| Method | Path          | Action        |
|--------|---------------|---------------|
| GET    | `/`           | List (paginated) |
| GET    | `/:id`        | Get one       |
| POST   | `/`           | Create        |
| PUT    | `/:id`        | Update        |
| DELETE | `/:id`        | Delete        |

Products automatically **populate** their `shop`, `category`, `motherCategory`, `company` and `capacity` on list/get. The product module also provides Excel bulk import/export, a price-update upload, a reorder endpoint, and a category-grouped price-list PDF.

### Example

```bash
# Create a shop (every product belongs to one)
curl -X POST http://127.0.0.1:5001/api/shops \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"name":"Main Road Outlet","phone":"9876543210"}'

# Create a category
curl -X POST http://127.0.0.1:5001/api/categories \
  -H "Content-Type: application/json" \
  -d '{"name":"Whisky","slug":"whisky","icon":"Wine"}'

# Create a product (use the shop and category _ids returned above)
curl -X POST http://127.0.0.1:5001/api/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"name":"Example Whisky 750 ml","shop":"<shopId>","category":"<catId>","mrp":1250,"purchasePrice":980,"perAlternateUnitQty":12,"stockAlertQty":6,"inventory":0}'
```

## Adding more modules

```bash
# from the project root (calmapi.json must be present)
npx calmapi generate module order
```

Then edit `src/modules/order/order.model.js` (schema), `order.dto.js` (exposed fields), and `order.route.js` (routes). New modules are picked up automatically on restart.

## Notes

- **Auth:** calmapi ships JWT auth (`/api/auth`) and a `user` module. Product **writes** require a valid admin JWT (`Authorization: Bearer <token>`); product reads are public. To protect any other module, add this to its `*.route.js`:
  ```js
  const AuthController = require('../auth/auth.controller');
  router.use(AuthController.checkLogin);
  ```
- The scaffold's `system/configs/database.js` was updated to drop Mongoose 5 options (`useNewUrlParser`, etc.) that Mongoose 8 rejects.
