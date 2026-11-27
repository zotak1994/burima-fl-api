'use strict';
const slugify = ( text ) => {
    return text.toString().toLowerCase()
        .replace( /\s+/g, '-' ) // Replace spaces with -
        .replace( /[^\w\-.]+/g, '' ) // Remove all non-word chars
        .replace( /--+/g, '-' ) // Replace multiple - with single -
        .replace( /^-+/, '' ) // Trim - from start of text
        .replace( /-+$/, '' ); // Trim - from end of text
};

// Normalize any monetary amount to 2 decimal places (kept as a Number).
// Use as a Mongoose field `set` so every amount is stored as e.g. 6.99, 54.00 -> 54.
const toAmount = ( value ) => {
    if ( value === null || value === undefined || value === '' ) {
        return value;
    }
    const num = Number( value );
    if ( Number.isNaN( num ) ) {
        return value;
    }
    return Number( num.toFixed( 2 ) );
};

/**
 * Refuse to delete a classifier that products are still filed under.
 *
 * A product's category, mother category, company and measurement are
 * required, so removing one out from under a product does not tidy anything
 * up — it leaves the product pointing at a record that no longer exists. The
 * catalogue then shows a blank column, the stock report's filter for it
 * matches nothing, and the product cannot be saved again until the missing
 * value is replaced. Better to say so and let the admin re-file first.
 *
 * Counted on products only: purchases and sales reference products, never
 * these.
 * @param { Object } args
 * @param { * } args.id - the record about to be deleted
 * @param { string } args.field - the product field that points at it
 * @param { string } args.label - what to call it in the message
 */
async function assertNotInUse( { id, field, label } ) {
    // Required late: utils is loaded before the models are registered.
    // eslint-disable-next-line global-require
    const mongoose = require( 'mongoose' );
    // eslint-disable-next-line global-require
    const { CalmError } = require( '../../system/core/CalmError' );

    if ( !id || !mongoose.Types.ObjectId.isValid( id ) ) {
        return;
    }
    const used = await mongoose.model( 'product' ).countDocuments( {
        [ field ]: new mongoose.Types.ObjectId( String( id ) )
    } );
    if ( used > 0 ) {
        throw new CalmError(
            'VALIDATION_ERROR',
            `This ${ label } is used by ${ used } product`
            + `${ used === 1 ? '' : 's' } and cannot be deleted. `
            + `Move ${ used === 1 ? 'it' : 'them' } to another ${ label } first.`
        );
    }
}

/**
 * Refuse to delete products that a purchase or a sale has already recorded.
 *
 * A line keeps a snapshot of the product's name, so an old invoice still
 * prints correctly — but it also keeps the product's id, and the stock engine
 * rebuilds every balance by grouping those ids. Delete the product and the
 * documents point at nothing, the stock report loses the rows it was built
 * from, and the excise return stops reconciling. The catalogue entry has to
 * stay; `status: false` is how a product is taken off the shelf.
 *
 * Counted over purchases and sales only. Stock snapshots reference products
 * too, but they are derived from these documents and can be rebuilt, so they
 * are not an independent reason to refuse.
 *
 * One aggregate per collection rather than a query per product, so a bulk
 * delete of a hundred rows is still two round trips.
 *
 * @param { Array } ids the products about to be deleted
 */
async function assertProductsNotInUse( ids ) {
    // Required late: utils is loaded before the models are registered.
    // eslint-disable-next-line global-require
    const mongoose = require( 'mongoose' );
    // eslint-disable-next-line global-require
    const { CalmError } = require( '../../system/core/CalmError' );

    const wanted = ( Array.isArray( ids ) ? ids : [ ids ] )
        .map( ( id ) => String( id || '' ) )
        .filter( ( id ) => mongoose.Types.ObjectId.isValid( id ) );
    if ( !wanted.length ) {
        return;
    }
    const asObjectIds = wanted.map( ( id ) => new mongoose.Types.ObjectId( id ) );

    /** How many documents of `model` reference each product id. */
    const countsBy = async ( model ) => {
        const rows = await mongoose.model( model ).aggregate( [
            { '$match': { 'items.product': { '$in': asObjectIds } } },
            { '$unwind': '$items' },
            { '$match': { 'items.product': { '$in': asObjectIds } } },
            // A product can appear on several lines of one invoice; count the
            // invoice once, not once per line.
            { '$group': { '_id': '$items.product', 'docs': { '$addToSet': '$_id' } } }
        ] );
        return new Map( rows.map( ( r ) => [ String( r._id ), r.docs.length ] ) );
    };

    const [ purchases, sales ] = await Promise.all( [
        countsBy( 'purchase' ),
        countsBy( 'sale' )
    ] );

    const blocked = wanted.filter( ( id ) => purchases.has( id ) || sales.has( id ) );
    if ( !blocked.length ) {
        return;
    }

    // Names, so the message says what the admin is looking at rather than ids.
    const named = await mongoose.model( 'product' )
        .find( { '_id': { '$in': blocked.map( ( id ) => new mongoose.Types.ObjectId( id ) ) } } )
        .select( 'name' )
        .lean();
    const nameOf = new Map( named.map( ( p ) => [ String( p._id ), p.name ] ) );

    // Per-product detail, so a caller can show it against the right row.
    const errors = {};
    blocked.forEach( ( id ) => {
        const p = purchases.get( id ) || 0;
        const s = sales.get( id ) || 0;
        const parts = [];
        if ( p ) {
            parts.push( `${ p } purchase${ p === 1 ? '' : 's' }` );
        }
        if ( s ) {
            parts.push( `${ s } sale${ s === 1 ? '' : 's' }` );
        }
        errors[ id ] = `Used by ${ parts.join( ' and ' ) }`;
    } );

    const label = ( id ) => nameOf.get( id ) || 'a product';
    const message = blocked.length === 1
        ? `${ label( blocked[ 0 ] ) } is used by ${ errors[ blocked[ 0 ] ].replace( 'Used by ', '' ) } and cannot be deleted. Deactivate it instead.`
        : `${ blocked.length } of the selected products are used by purchases or sales and cannot be deleted: `
            + `${ blocked.slice( 0, 5 ).map( label ).join( ', ' ) }`
            + `${ blocked.length > 5 ? `, and ${ blocked.length - 5 } more` : '' }. Deactivate them instead.`;

    throw new CalmError( 'VALIDATION_ERROR', message, null, errors );
}

module.exports = { slugify, toAmount, assertNotInUse, assertProductsNotInUse };
