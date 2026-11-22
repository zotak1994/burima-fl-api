'use strict';
const { CalmService } = require( '../../../system/core/CalmService' );
const { assertNotInUse } = require( '../../utils' );

class CompanyService extends CalmService {
    // Setting Global Populate to apply in Get All & Get Single
    populateFields = [ { path: 'createdBy' } ];
    // Fields matched by the `search` query param
    searchFields = [ 'name' ];
    constructor( model ) {
        super( model );
    }

    /**
     * Ordered by the manual displayNumber (ascending) by default, so the
     * admin-arranged position is reflected everywhere.
     */
    async getAll( query, ops = {} ) {
        if ( !query.sortBy ) {
            // eslint-disable-next-line no-param-reassign
            query = { ...query, sortBy: { 'displayNumber': 1, 'createdAt': 1 } };
        }
        return super.getAll( query, ops );
    }

    /**
     * Auto-assign the next displayNumber (max + 1) when one isn't provided,
     * so new records always land at the end of the ordered list.
     */
    async insert( data ) {
        const payload = { ...data };
        if ( payload.displayNumber === undefined || payload.displayNumber === null ) {
            const last = await this.model
                .findOne()
                .sort( { 'displayNumber': -1 } )
                .select( 'displayNumber' );
            payload.displayNumber = last ? ( last.displayNumber || 0 ) + 1 : 1;
        }
        return super.insert( payload );
    }

    /**
     * Persist a new ordering in one bulk write.
     * @param { Array<{ id: string, displayNumber: number }> } items
     */
    async reorder( items ) {
        if ( !Array.isArray( items ) || !items.length ) {
            return { 'data': { 'updated': 0 } };
        }
        const operations = items
            .filter( ( it ) => it && it.id )
            .map( ( it ) => ( {
                'updateOne': {
                    'filter': { '_id': it.id },
                    'update': { '$set': { 'displayNumber': Number( it.displayNumber ) } }
                }
            } ) );

        if ( !operations.length ) {
            return { 'data': { 'updated': 0 } };
        }
        const result = await this.model.bulkWrite( operations );
        return { 'data': { 'updated': result.modifiedCount } };
    }

    /**
     * Delete, unless products are still filed under this company.
     * See assertNotInUse: removing it would leave them pointing at nothing.
     * @param { string } id
     */
    async delete( id ) {
        await assertNotInUse( {
            id, 'field': 'company', 'label': 'company'
        } );
        return super.delete( id );
    }
}

module.exports = { CompanyService };
