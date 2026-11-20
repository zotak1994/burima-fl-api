'use strict';
const autoBind = require( 'auto-bind' );
class CalmService {
    populateFields = [];
    // Fields a module wants the `search` query param to match (case-insensitive regex).
    searchFields = [];
    /**
     * Calm Service
     * @author Sunil Kumar Samanta
     * @param model Current Model Instance
     */
    constructor( model ) {
        this.model = model;
        this.parseObj = data => JSON.parse(JSON.stringify(data));
        autoBind( this );
    }

    /**
     * Get All Items
     * @param { Object } query Query Parameters
     * @param {Object} [ops] Options
     * @param {Array} [ops.populateFields] Populate Fields
     * @param {Array} [ops.searchFields] Fields matched by the `search` param
     *
     * Supported query params: skip (default 0), limit (default 100),
     * search (case-insensitive match across the module's searchFields),
     * sortBy, and any other key as an exact filter.
     */
    async getAll( query, ops = {} ) {
        let populateFields = this.populateFields;
        if(Array.isArray(ops.populateFields)) {
            populateFields = ops.populateFields;
        }
        const searchFields = Array.isArray( ops.searchFields ) ? ops.searchFields : this.searchFields;

        // eslint-disable-next-line prefer-const
        let { skip, limit, sortBy, search, ...restQuery } = query;

        skip = skip ? Number( skip ) : 0;
        limit = limit ? Number( limit ) : 100;
        sortBy = sortBy ? sortBy : { 'createdAt': -1 };

        // Build the Mongo filter from any exact-match params, plus an optional text search.
        const filter = { ...restQuery };
        if ( search && Array.isArray( searchFields ) && searchFields.length ) {
            const term = String( search ).trim();
            if ( term ) {
                filter.$or = searchFields.map( ( field ) => ( {
                    [ field ]: { $regex: term, $options: 'i' }
                } ) );
            }
        }

        try {
            const items = await this.model.find( filter ).sort( sortBy ).skip( skip ).limit( limit ).populate(populateFields);

            const total = await this.model.countDocuments( filter );

            // Whether there are more items beyond the current page.
            const hasNext = skip + items.length < total;
            // Reserved for pagination/extra info; kept empty for now.
            const metaData = {};

            return { 'data': this.parseObj( items ), total, hasNext, metaData };
        } catch ( errors ) {
            throw errors;
        }
    }

    /**
     * Get Single Item
     * @param { string } id Instance ID
     * @param {Object} [ops] Options
     * @param {Array} [ops.populateFields] Populate Fields [{path: 'fieldName', select: 'prop1 prop2 ...', populate: 'childFieldName'}]
     */
    async get( id, ops = {} ) {
        let populateFields = this.populateFields;
        if(Array.isArray(ops.populateFields)) {
            populateFields = ops.populateFields;
        }
        try {
            const item = await this.model.findById( id ).populate(populateFields);

            if ( !item ) {
                throw new Error('NOT_FOUND_ERROR');
            }

            return { 'data': item.toJSON() };
        } catch ( errors ) {
            throw errors;
        }
    }

    /**
     * Create Item
     * @param { Object } data Instance Object
     */
    async insert( data ) {
        try {
            const item = await this.model.create( data );
            if ( item ) {
                return { 'data': item.toJSON() };
            }
            throw new Error( 'UNKNOWN_ERROR' );

        } catch ( error ) {
            throw error;
        }
    }

    /**
     * Update Item
     * @param { string } id Instance ID
     * @param { Object } data Updated Object
     */
    async update( id, data ) {
        try {
            const item = await this.model.findByIdAndUpdate( id, { ...data }, { 'new': true, runValidators: true, context: 'query' } );

            if ( item ) {
                return { 'data': this.parseObj( item ) };
            }
            throw new Error( 'NOT_FOUND_ERROR' );
        } catch ( errors ) {
            throw errors;
        }
    }

    /**
     * Delete Item
     * @param { string } id Item ID
     */
    async delete( id ) {
        try {
            const item = await this.model.findByIdAndDelete( id );

            if ( !item ) {
                throw new Error('NOT_FOUND_ERROR');
            } else {
                return { 'data': this.parseObj( item ), 'deleted': true };
            }
        } catch ( errors ) {
            throw errors;
        }
    }
}

module.exports = {
    CalmService
};
