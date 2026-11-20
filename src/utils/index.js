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

module.exports = { slugify, toAmount };
