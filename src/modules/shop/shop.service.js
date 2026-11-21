'use strict';
const { CalmService } = require( '../../../system/core/CalmService' );
const { CalmError } = require( '../../../system/core/CalmError' );

class ShopService extends CalmService {
    // Setting Global Populate to apply in Get All & Get Single
    populateFields = [ { path: 'createdBy' } ];
    // Fields matched by the `search` query param
    searchFields = [ 'name', 'phone' ];
    constructor( model ) {
        super( model );
    }

    /**
     * Ordered by the manual displayNumber (ascending) by default, so the
     * admin-arranged position is reflected everywhere — including the shop
     * switcher in the admin header.
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
     * so new shops always land at the end of the ordered list.
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
     * Refuse to delete a shop that still owns products, so a delete can never
     * orphan catalogue rows. Sell and purchase orders should be added to this
     * check as those modules land.
     * @param { string } id
     */
    async delete( id ) {
        const Product = this.model.db.models.product
            || this.model.db.model( 'product' );
        const inUse = await Product.countDocuments( { 'shop': id } );
        if ( inUse > 0 ) {
            throw new CalmError(
                'VALIDATION_ERROR',
                `This shop still has ${ inUse } product(s). Move or remove them first.`
            );
        }
        return super.delete( id );
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
}

module.exports = { ShopService };
