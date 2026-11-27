'use strict';
const { CalmService } = require( '../../../system/core/CalmService' );
const { CalmError } = require( '../../../system/core/CalmError' );
const { Auth } = require( '../auth/auth.model' );
const { normalisePermissions, toShopIds } = require( '../../utils/access' );
const mongoose = require( 'mongoose' );
const autoBind = require( 'auto-bind' );

/**
 * Settle an account's shop and module grants before they are written.
 *
 * An admin is never scoped, so both lists are emptied on that role rather
 * than left to go stale — otherwise demoting the account back to `user` would
 * silently restore grants nobody reviewed. A `user` gets its lists cleaned up:
 * unknown module names dropped, ids de-duplicated, malformed ids refused.
 *
 * Only keys actually present are touched, so a partial update (a status
 * toggle, say) does not wipe grants it never mentioned.
 *
 * @param { Object } data the incoming DTO
 * @param { string } [currentRole] the role on record, for an update that does
 *   not restate it
 */
const applyGrants = ( data, currentRole ) => {
    const role = data.role !== undefined ? data.role : currentRole;
    const payload = { ...data };

    if ( role === 'admin' ) {
        payload.shops = [];
        payload.permissions = [];
        return payload;
    }

    if ( payload.permissions !== undefined ) {
        payload.permissions = normalisePermissions( payload.permissions );
    }

    if ( payload.shops !== undefined ) {
        const ids = toShopIds( payload.shops );
        const bad = ids.filter( ( id ) => !mongoose.Types.ObjectId.isValid( id ) );
        if ( bad.length ) {
            throw new CalmError( 'VALIDATION_ERROR', 'Shop access contains an invalid shop' );
        }
        payload.shops = ids;
    }

    return payload;
};

/** Did an update actually change the list, order aside? */
const listChanged = ( before, after ) => {
    if ( after === undefined ) {
        return false;
    }
    const a = [ ...( before || [] ) ].map( String ).sort();
    const b = [ ...( after || [] ) ].map( String ).sort();
    return a.length !== b.length || a.some( ( value, i ) => value !== b[ i ] );
};

class UserService extends CalmService {
    // Shops come back populated so the admin table can name them rather than
    // printing ids.
    populateFields = [ { path: 'shops', select: 'name phone displayNumber' } ];
    // Fields matched by the `search` query param
    searchFields = [ 'name', 'email' ];
    constructor( model ) {
        super( model );
        this.model = model;
        autoBind( this );
    }

    /**
     * Delete every stored session token for a user, forcing them to log in
     * again on their next request (checkLogin rejects tokens missing from DB).
     */
    async invalidateSessions( userId ) {
        try {
            const authModel = new Auth().getInstance();
            await authModel.deleteMany( { 'user': userId } );
        } catch ( e ) {
            // Never fail the parent operation just because cleanup failed.
            console.error( 'Failed to invalidate sessions for user', userId, e );
        }
    }

    /** Create. Grants are settled first so an admin never carries any. */
    async insert( data ) {
        try {
            return await super.insert( applyGrants( data, 'user' ) );
        } catch ( errors ) {
            throw errors;
        }
    }

    /**
     * Admin update. When a user's password changes, their status actually
     * flips, or their access changes, we revoke all their sessions so the
     * change takes effect at once.
     *
     * Revoking on an access change is the point rather than a nicety: the
     * admin portal caches role, shops and permissions in the browser session,
     * so without this a user whose access was just withdrawn would keep the
     * old menu until they happened to sign out.
     */
    async update( id, data ) {
        try {
            const current = await this.model.findById( id );
            if ( !current ) {
                throw new CalmError( 'NOT_FOUND_ERROR' );
            }
            const payload = applyGrants( data, current.role );
            const result = await super.update( id, payload );

            const passwordChanged =
                data.password !== undefined &&
                data.password !== null &&
                data.password !== '';
            const statusChanged =
                data.status !== undefined &&
                current.status !== data.status;
            const roleChanged =
                payload.role !== undefined &&
                current.role !== payload.role;
            const accessChanged =
                roleChanged ||
                listChanged( current.permissions, payload.permissions ) ||
                listChanged( toShopIds( current.shops ), payload.shops );

            if ( passwordChanged || statusChanged || accessChanged ) {
                await this.invalidateSessions( id );
            }
            return result;
        } catch ( errors ) {
            throw errors;
        }
    }


    async updatePassword( id, data ) {
        try {
            const user = await this.model.findById( id );
            user.password = data;
            await user.save();
            await this.invalidateSessions( id );
            return { 'passwordChanged': true };
        } catch ( errors ) {
            throw errors;
        }
    }

    async updateProfile( id, data ) {
        try {
            const user = await this.model.findById( id );
            if( data.password ) {
                user.password = data.password;
            }
            user.name = data.name;
            await user.save();
            return { 'updated': true };
        } catch ( errors ) {
            throw errors;
        }
    }

    /**
     *
     * @param email : string
     * @param includePassword : boolean
     * @returns {Promise<*>}
     */
    async findByEmail( email, includePassword = false ) {
        let data;
        if ( includePassword ) {
            data = await this.model.findByEmail( email ).select( '+password' );
        } else {
            data = await this.model.findByEmail( email );
        }
        return { data };
    }
}

// applyGrants / listChanged are exported for tests; the service is the only
// production caller.
module.exports = { UserService, applyGrants, listChanged };
