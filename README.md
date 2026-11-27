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
| User      | `/api/users`        | `name`, `email`, `password`, `role`, `shops` (refs), `permissions`, … |
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

`POST /api/products/delete-many` (admin, body `{ ids: [...] }`) deletes several
at once. Deleting a product — one or many — is **refused with a 422 if any
purchase or sale already records it**: those documents keep the product's id
and the stock engine rebuilds every balance by grouping on it, so removing the
catalogue entry would break the stock report and the excise return. Take a
product off the shelf with `status: false` instead. A bulk delete is all or
nothing, and the error names the products at fault (with per-id detail in
`errors`) rather than half-completing.

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

- **Auth:** calmapi ships JWT auth (`/api/auth`) and a `user` module. Sign in
  with `POST /api/auth/login` and send `Authorization: Bearer <token>`.
  `POST /api/auth/register` takes no token, so it always creates an
  unprivileged `user` with no access — `role`, `shops` and `permissions` are
  ignored there. Accounts are given access from the portal's Users screen.

- **Access control:** two roles. An `admin` reaches everything. A `user`
  reaches only the modules granted on its account, and only for the shops
  assigned to it. Both lists live on the user document (`permissions`,
  `shops`) and come back on login, which is where the admin portal reads them
  from. Changing either revokes that account's sessions, so a withdrawn grant
  takes effect at once rather than on next sign-out.

  The three grants are `purchases`, `sales` and `reports` (`reports` covers
  the stock, sales, summary and excise screens). Everything shared across
  outlets — the catalogue lookups, shops, users, the stock rebuild — is
  admin-only and not grantable. Catalogue and shop **reads** stay public,
  because the purchase and sale entry screens need them.

  On purchases and sales a `user` sees only **its own entries**: the lists are
  forced to `createdBy = <the token's user>`, and someone else's document
  reads as a 404 rather than a 403, so whether it exists stays private.

  For a `user`, **confirming is the point of no return.** An entry is created
  as a draft (`status` is not settable on insert), is freely editable and
  deletable while it is one, and becomes read-only the moment it is confirmed:
  `PUT /:id` and `DELETE /:id` are refused with a 422, and `PUT /:id/unconfirm`
  is admin-only — taking an entry back to draft moves stock that was already
  posted, so it is a correction an administrator makes, not a staff undo.
  Reads are untouched, so a confirmed entry stays viewable. An admin can still
  edit a confirmed entry, which reposts it to stock.

  The
  reports are deliberately shop-wide — they are reconciliation figures that
  have to agree with stock and the excise return, and a total covering one
  person's entries would not. Withhold the `reports` grant if staff should not
  see shop-wide numbers.

  The rules live in `src/utils/access.js`; a route file states what it needs:
  ```js
  const AuthController = require('../auth/auth.controller');
  const { requireAdmin, requirePermission, scopeToShops } = require('../../utils/access');

  router.use(AuthController.checkLogin);        // signed in
  router.use(requirePermission('purchases'));   // ...and granted this module

  // Held to the account's own shops. Attach per route, not with router.use():
  // the check reads req.params.id to find the document's own shop.
  const scope = scopeToShops({ model: 'purchase' });
  router.get('/', scope, PurchaseController.getAll);

  // Or, for something shared by every outlet:
  router.post('/', AuthController.checkLogin, requireAdmin, CategoryController.insert);
  ```
- The scaffold's `system/configs/database.js` was updated to drop Mongoose 5 options (`useNewUrlParser`, etc.) that Mongoose 8 rejects.
