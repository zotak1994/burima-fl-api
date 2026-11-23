'use strict';
const mongoose = require( 'mongoose' );
const dayjs = require( '../../utils/day' );
const { CalmError } = require( '../../../system/core/CalmError' );

/** Round to 2dp the same way the amount setter does. */
function money( n ) {
    return Math.round( ( Number( n ) || 0 ) * 100 ) / 100;
}

/**
 * A figure the client has already worked out. Returns null when it sent none,
 * so the caller can fall back to computing it, and throws when what it sent
 * is not a usable number — saving as sent is not the same as saving anything.
 * @param { * } value - the raw value from the payload
 * @param { string } label - how to name it in an error
 * @param { boolean } [signed] - true when it is allowed to be negative
 * @returns { number | null }
 */
function clientFigure( value, label, signed = false ) {
    if ( value === undefined || value === null || value === '' ) {
        return null;
    }
    const n = Number( value );
    if ( !Number.isFinite( n ) ) {
        throw new CalmError( 'VALIDATION_ERROR', `${ label } is not a number.` );
    }
    if ( !signed && n < 0 ) {
        throw new CalmError( 'VALIDATION_ERROR', `${ label } cannot be negative.` );
    }
    return money( n );
}

/**
 * Validate the lines of a stock document — a purchase or a sale — and
 * snapshot each product's name.
 *
 * The figures are the client's: the entry screen has already worked out every
 * line's rate and amount and the document totals, so they are stored as sent.
 * What is checked here is everything arithmetic cannot settle — that the
 * product exists and belongs to this outlet, that the quantity is a whole
 * number of bottles, and that the money is a non-negative number. A figure
 * left out is computed, so a leaner client still stores a coherent document.
 * @param { Object } args
 * @param { Array } args.items
 * @param { * } args.shopId - the document's outlet; every product must be its own
 * @param { Object } [args.totals] - the payload, read for totalQty / totalAmount
 * @param { string } [args.fallbackRate] - a product field to price a line by
 *        when it names neither a rate nor an amount. Sales pass 'mrp', so a
 *        client can send nothing but a product and a quantity.
 * @returns { Promise<{ items: Array, totalQty: number, totalAmount: number }> }
 */
async function normaliseLines( { items, shopId, totals = {}, fallbackRate } ) {
    const rows = Array.isArray( items ) ? items : [];
    const clean = [];
    const errors = [];

    // One lookup for every referenced product, so a line cannot name a
    // product from another outlet (or one that no longer exists).
    const ids = rows
        .map( ( r ) => r && r.product )
        .filter( ( id ) => id && mongoose.Types.ObjectId.isValid( id ) )
        .map( ( id ) => new mongoose.Types.ObjectId( String( id ) ) );
    const Product = mongoose.model( 'product' );
    const found = ids.length
        ? await Product.find( { '_id': { '$in': ids } } )
            .select( 'name shop mrp' ).lean()
        : [];
    const byId = new Map( found.map( ( p ) => [ String( p._id ), p ] ) );

    rows.forEach( ( row, i ) => {
        const line = i + 1;
        if ( !row || !row.product ) {
            errors.push( `line ${ line }: product is required` );
            return;
        }
        const product = byId.get( String( row.product ) );
        if ( !product ) {
            errors.push( `line ${ line }: product not found` );
            return;
        }
        if ( shopId && String( product.shop ) !== String( shopId ) ) {
            errors.push(
                `line ${ line }: "${ product.name }" belongs to another shop`
            );
            return;
        }
        const qty = Number( row.qty );
        if ( !Number.isInteger( qty ) || qty < 1 ) {
            errors.push(
                `line ${ line }: qty must be a whole number of at least 1`
            );
            return;
        }
        // Both figures as sent. They are two views of the same money and will
        // not always reconcile to the paise — a rate rounded to paise times a
        // quantity rarely lands back on the document's figure, 1000.00 over 12
        // bottles being 83.33 a bottle, which multiplies back to 999.96 — so
        // neither is recomputed from the other. Only a figure the client
        // leaves out is filled in.
        let rate;
        let amount;
        try {
            rate = clientFigure( row.rate, `line ${ line }: rate` );
            amount = clientFigure( row.amount, `line ${ line }: amount` );
        } catch ( e ) {
            errors.push( e.message.replace( /\.$/, '' ) );
            return;
        }
        if ( rate === null && amount === null ) {
            // A sale priced at the MRP needs neither: the product carries it.
            const listed = fallbackRate ? Number( product[ fallbackRate ] ) : NaN;
            if ( !Number.isFinite( listed ) || listed <= 0 ) {
                errors.push( `line ${ line }: rate or amount is required` );
                return;
            }
            rate = money( listed );
        }
        clean.push( {
            'product': product._id,
            'name': product.name,
            qty,
            'rate': rate === null ? money( amount / qty ) : rate,
            'amount': amount === null ? money( qty * rate ) : amount
        } );
    } );

    if ( errors.length ) {
        throw new CalmError( 'VALIDATION_ERROR', errors.join( '; ' ) );
    }

    // The totals as sent too, and summed from the lines when they are not.
    const sentQty = clientFigure( totals.totalQty, 'Total qty' );
    const sentAmount = clientFigure( totals.totalAmount, 'Total amount' );
    return {
        'items': clean,
        'totalQty': sentQty === null
            ? clean.reduce( ( sum, it ) => sum + it.qty, 0 )
            : sentQty,
        'totalAmount': sentAmount === null
            ? money( clean.reduce( ( sum, it ) => sum + it.amount, 0 ) )
            : sentAmount
    };
}

/**
 * A stock document can be back-dated freely but never dated ahead. The
 * browser's `max` only governs the picker, so the rule is enforced here too.
 *
 * Fourteen hours of slack, because a 'YYYY-MM-DD' value is parsed as UTC
 * midnight: for a client east of UTC that can sit up to 14 hours ahead of the
 * server's clock and still be the client's own today. That is the tightest
 * bound that never rejects a legitimate entry. Without knowing the client's
 * offset the server cannot tell "tomorrow at UTC+14" from "today at UTC+14",
 * so the UI's `max` is what holds that line; this stops anything beyond it.
 * @param { * } value - whatever the client sent as `date`
 * @param { string } [label] - what to call the document in the error
 */
function assertNotFutureDate( value, label = 'purchase' ) {
    if ( value === undefined || value === null || value === '' ) return;
    // Parsed in UTC so a 'YYYY-MM-DD' value is midnight UTC — the whole
    // reason the slack below is fourteen hours and not zero.
    const when = dayjs.utc( value );
    if ( !when.isValid() ) {
        throw new CalmError( 'VALIDATION_ERROR', 'Date is not a valid date.' );
    }
    const limit = dayjs().add( 14, 'hour' );
    if ( when.isAfter( limit ) ) {
        throw new CalmError(
            'VALIDATION_ERROR', `A ${ label } cannot be dated in the future.`
        );
    }
}

module.exports = { money, clientFigure, normaliseLines, assertNotFutureDate };
