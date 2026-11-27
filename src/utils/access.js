'use strict';
const { CalmError } = require( '../../system/core/CalmError' );

/**
 * Role and shop based access control.
 *
 * An admin reaches everything. A `user` account reaches only the modules
 * granted to it, and only for the outlets assigned to it. The admin portal
 * hides what an account cannot use, but hiding a link is not enforcement —
 * these middlewares are what actually refuse the request.
 *
 * Kept in one file so the rule lives in one place: a route file says what it
 * needs and nothing more.
 */

/**
 * The grantable modules. Deliberately coarse — three switches, matching the
 * admin portal's user form. `reports` covers the stock, sales, summary and
 * excise screens, which the back office thinks of as one thing.
 */
const PERMISSIONS = [ 'purchases', 'sales', 'reports' ];

/** Keep only recognised permission names, de-duplicated. */
const normalisePermissions = ( raw ) => {
    if ( !Array.isArray( raw ) ) {
        return [];
    }
    const seen = raw
        .map( ( value ) => String( value || '' ).trim().toLowerCase() )
        .filter( ( value ) => PERMISSIONS.includes( value ) );
    return [ ...new Set( seen ) ];
};

/**
 * Plain ids out of a list of shop refs, which may be populated documents or
 * bare ObjectIds depending on whether the caller populated them.
 */
const toShopIds = ( shops ) => {
    if ( !Array.isArray( shops ) ) {
        return [];
    }
    const seen = shops
        .map( ( shop ) => {
            if ( !shop ) {
                return '';
            }
            return String( shop._id ? shop._id : shop );
        } )
        .filter( Boolean );
    return [ ...new Set( seen ) ];
};

const isAdminUser = ( user ) => Boolean( user ) && user.role === 'admin';

/**
 * Ids of the outlets a request may touch, or null for "no restriction" —
 * which only an admin gets.
 *
 * Fails closed: a `user` with no shops assigned gets an empty list, not every
 * shop, so a half-created account cannot see the whole business.
 */
const allowedShopIds = ( user ) => {
    if ( isAdminUser( user ) ) {
        return null;
    }
    return toShopIds( user && user.shops );
};

/** Does this account hold `permission`? Admins hold all of them. */
const userHasPermission = ( user, permission ) => {
    if ( isAdminUser( user ) ) {
        return true;
    }
    return normalisePermissions( user && user.permissions ).includes( permission );
};

/**
 * Admin-only route. Use it on everything shared across outlets — the
 * catalogue lookups, shops, and the user accounts themselves — because a
 * change there changes what every other shop sees.
 *
 * Always mounted after AuthController.checkLogin, which is what sets req.user.
 */
const requireAdmin = ( req, res, next ) => {
    if ( isAdminUser( req.user ) ) {
        return next();
    }
    return next( new CalmError(
        'PERMISSION_DENIED_ERROR',
        'This action is restricted to administrators'
    ) );
};

/**
 * Route that needs one named grant, e.g. requirePermission( 'purchases' ).
 * @param { string } permission one of PERMISSIONS
 */
const requirePermission = ( permission ) => ( req, res, next ) => {
    if ( userHasPermission( req.user, permission ) ) {
        return next();
    }
    return next( new CalmError(
        'PERMISSION_DENIED_ERROR',
        `You don't have access to ${ permission }`
    ) );
};

/**
 * Route reachable with any one of several grants.
 *
 * Needed because two screens straddle the split: the sales report and the
 * sales summary are Report screens in the portal but live under /sales on the
 * API. Either grant is enough — both show the account's own shops' sales, so
 * neither widens what it can already see.
 *
 * @param { string[] } permissions
 */
const requireAnyPermission = ( permissions ) => ( req, res, next ) => {
    const ok = permissions.some( ( permission ) => userHasPermission( req.user, permission ) );
    if ( ok ) {
        return next();
    }
    return next( new CalmError(
        'PERMISSION_DENIED_ERROR',
        `You don't have access to ${ permissions.join( ' or ' ) }`
    ) );
};

/**
 * Hold a request to the outlets the account may work in.
 *
 * Three cases, because a shop reaches a request three different ways:
 *
 *  - a list or report filtered by `?shop=` — the id is checked, and when none
 *    was sent the filter is narrowed to the account's own shops rather than
 *    left open;
 *  - a create carrying `shop` in the body — the id is checked;
 *  - anything addressing one existing document by `:id` — the document's own
 *    shop is checked, since `shop` is not updatable and so never in the body.
 *
 * With `ops.ownedOnly`, a non-admin is additionally held to the documents it
 * created: its own entries, not everything its colleagues entered for the same
 * shop. `createdBy` is stamped from the token by CalmController.insert and is
 * not updatable, so it is a safe thing to filter on.
 *
 * @param { Object } [ops]
 * @param { string } [ops.model] mongoose model name holding a `shop` field,
 *   needed only for the `:id` case (e.g. 'purchase', 'sale').
 * @param { boolean } [ops.requireShop] refuse a list with no `?shop=` instead
 *   of narrowing it. For reports, which are built one outlet at a time.
 * @param { boolean } [ops.ownedOnly] also limit a non-admin to the documents
 *   it created. Needs `ops.model` to cover the `:id` case.
 * @param { boolean } [ops.draftOnly] a non-admin may only CHANGE the document
 *   while it is still a draft. Confirming is what makes an entry final for
 *   staff: afterwards they can read it but not alter it. Reads are untouched,
 *   so a confirmed entry stays viewable. Needs `ops.model`.
 */
const scopeToShops = ( ops = {} ) => async ( req, res, next ) => {
    try {
        const allowed = allowedShopIds( req.user );
        // null => an admin, who is not scoped to anything.
        if ( allowed === null ) {
            return next();
        }
        if ( !allowed.length ) {
            throw new CalmError(
                'PERMISSION_DENIED_ERROR',
                'No shops are assigned to your account'
            );
        }

        const deny = () => new CalmError(
            'PERMISSION_DENIED_ERROR',
            'You don\'t have access to this shop'
        );

        // A create (or any other body) naming a shop.
        if ( req.body && req.body.shop !== undefined && req.body.shop !== null && req.body.shop !== '' ) {
            if ( !allowed.includes( String( req.body.shop ) ) ) {
                throw deny();
            }
        }

        // One existing document, addressed by id. Its shop is authoritative
        // because `shop` is deliberately not updatable on purchases or sales.
        if ( req.params && req.params.id && ops.model ) {
            // Required late: utils loads before the models are registered.
            // eslint-disable-next-line global-require
            const mongoose = require( 'mongoose' );
            if ( !mongoose.Types.ObjectId.isValid( req.params.id ) ) {
                throw new CalmError( 'NOT_FOUND_ERROR' );
            }
            const doc = await mongoose.model( ops.model )
                .findById( req.params.id )
                .select( 'shop createdBy status' )
                .lean();
            if ( !doc ) {
                throw new CalmError( 'NOT_FOUND_ERROR' );
            }
            if ( !allowed.includes( String( doc.shop ) ) ) {
                // Deliberately a 404, not a 403: whether a document exists in
                // another outlet is not this account's business.
                throw new CalmError( 'NOT_FOUND_ERROR' );
            }
            if ( ops.ownedOnly && String( doc.createdBy ) !== String( req.user._id ) ) {
                // Same reasoning: someone else's entry reads as absent, not
                // as forbidden.
                throw new CalmError( 'NOT_FOUND_ERROR' );
            }
            // Confirming is the point of no return for staff. Reads still go
            // through, so a confirmed entry remains viewable — it is only
            // changing one that is refused.
            const mutating = ![ 'GET', 'HEAD', 'OPTIONS' ].includes( req.method );
            if ( ops.draftOnly && mutating && doc.status === 'confirmed' ) {
                throw new CalmError(
                    'VALIDATION_ERROR',
                    'This entry is confirmed and can no longer be changed. '
                    + 'Ask an administrator if it needs correcting.'
                );
            }
        }

        // A list or report filtered by shop.
        if ( req.query ) {
            const asked = req.query.shop;
            if ( asked !== undefined && asked !== null && asked !== '' ) {
                if ( !allowed.includes( String( asked ) ) ) {
                    throw deny();
                }
            } else if ( ops.requireShop ) {
                // Phrased like the report controllers' own check, which says the
                // same thing a moment later for an admin.
                throw new CalmError( 'VALIDATION_ERROR', 'A report needs a shop.' );
            } else {
                // No shop asked for: narrow to the account's own outlets so a
                // bare list never spans the whole business. CalmService turns
                // leftover query keys into the Mongo filter directly, so this
                // becomes `shop: { $in: [...] }`.
                req.query.shop = { '$in': allowed };
            }

            // A list of documents: only this account's own. Forced rather than
            // merged, so passing ?createdBy=<someone else> cannot widen it.
            if ( ops.ownedOnly ) {
                req.query.createdBy = String( req.user._id );
            }
        }

        return next();
    } catch ( e ) {
        return next( e );
    }
};

module.exports = {
    PERMISSIONS,
    normalisePermissions,
    toShopIds,
    isAdminUser,
    allowedShopIds,
    userHasPermission,
    requireAdmin,
    requirePermission,
    requireAnyPermission,
    scopeToShops
};
