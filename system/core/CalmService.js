'use strict';

/**
 * Named sort orders accepted as `?sort=`. Clients send a name rather than a
 * Mongo sort object so the API never has to trust a caller-built sort.
 * `display` is the admin-arranged order that drag-to-reorder writes.
 */
const NAMED_SORTS = {
    'az': { 'name': 1 },
    'za': { 'name': -1 },
    'latest': { 'createdAt': -1 },
    'oldest': { 'createdAt': 1 },
    'display': { 'displayNumber': 1, 'createdAt': 1 }
};

/**
 * Sorting by name needs a case-insensitive collation: Mongo's default
 * byte order puts every capital ahead of every lower-case letter, so
 * "Zebra" would sort before "apple".
 */
const NAME_SORTS = [ 'az', 'za' ];
const NAME_COLLATION = { 'locale': 'en', 'strength': 2 };

/** The Mongo sort for a named order, or undefined when the name is unknown. */
function resolveNamedSort( sort ) {
    if ( !sort ) return undefined;
    return NAMED_SORTS[ String( sort ).trim().toLowerCase() ];
}

/** Whether a named order needs the case-insensitive collation. */
function needsNameCollation( sort ) {
    return NAME_SORTS.includes( String( sort || '' ).trim().toLowerCase() );
}
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
     * sort (az | za | latest | oldest | display), sortBy, and any other key
     * as an exact filter.
     *
     * A named `sort` takes precedence over `sortBy`, because a module's own
     * getAll() sets its default sortBy before delegating here — without that
     * precedence the module default would always win over the caller.
     */
    async getAll( query, ops = {} ) {
        let populateFields = this.populateFields;
        if(Array.isArray(ops.populateFields)) {
            populateFields = ops.populateFields;
        }
        const searchFields = Array.isArray( ops.searchFields ) ? ops.searchFields : this.searchFields;

        // `sort` must be destructured out even when unrecognised: anything
        // left in restQuery becomes an exact-match filter, so a stray
        // ?sort=whatever would filter on a field that does not exist and
        // return nothing at all.
        // eslint-disable-next-line prefer-const
        let { skip, limit, sortBy, sort, search, ...restQuery } = query;

        skip = skip ? Number( skip ) : 0;
        limit = limit ? Number( limit ) : 100;
        const named = resolveNamedSort( sort );
        if ( named ) {
            sortBy = named;
        } else {
            sortBy = sortBy ? sortBy : { 'createdAt': -1 };
        }

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
            let listQuery = this.model.find( filter ).sort( sortBy ).skip( skip ).limit( limit ).populate(populateFields);
            if ( named && needsNameCollation( sort ) ) {
                listQuery = listQuery.collation( NAME_COLLATION );
            }
            const items = await listQuery;

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
    NAMED_SORTS,
    NAME_COLLATION,
    resolveNamedSort,
    needsNameCollation,
    CalmService
};
