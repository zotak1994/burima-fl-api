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

module.exports = { slugify, toAmount, assertNotInUse };
