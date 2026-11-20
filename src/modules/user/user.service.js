'use strict';
const { CalmService } = require( '../../../system/core/CalmService' );
const { Auth } = require( '../auth/auth.model' );
const autoBind = require( 'auto-bind' );

class UserService extends CalmService {
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

    /**
     * Admin update. When a user's password changes, or their status actually
     * flips, we revoke all their sessions so the change takes effect at once.
     */
    async update( id, data ) {
        try {
            const current = await this.model.findById( id );
            const result = await super.update( id, data );

            const passwordChanged =
                data.password !== undefined &&
                data.password !== null &&
                data.password !== '';
            const statusChanged =
                data.status !== undefined &&
                current &&
                current.status !== data.status;

            if ( passwordChanged || statusChanged ) {
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

module.exports = { UserService };
