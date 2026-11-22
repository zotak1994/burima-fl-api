'use strict';
const mongoose = require( 'mongoose' );
const { CalmError } = require( '../../../system/core/CalmError' );
const { StockSnapshot } = require( './stock.model' );

const DAY = 24 * 60 * 60 * 1000;

/** Round to 2dp, the way every amount in this codebase is rounded. */
function money( n ) {
    return Math.round( ( Number( n ) || 0 ) * 100 ) / 100;
}

/**
 * The business day a date falls in, as midnight UTC. See the note on
 * `date` in stock.model.js for why UTC.
 * @param { * } value - a Date, an ISO string, or 'YYYY-MM-DD'
 * @returns { Date }
 */
function startOfDay( value ) {
    const when = value instanceof Date ? value : new Date( value );
    if ( Number.isNaN( when.getTime() ) ) {
        throw new CalmError( 'VALIDATION_ERROR', 'Stock date is not a date.' );
    }
    return new Date( Date.UTC(
        when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate()
    ) );
}

/** The day after the one `value` falls in, for an exclusive upper bound. */
function endOfDayExclusive( value ) {
    return new Date( startOfDay( value ).getTime() + DAY );
}

const asId = ( v ) => new mongoose.Types.ObjectId( String( v ) );
const key = ( product, date ) => `${ product }|${ date.getTime() }`;

/**
 * Group a document's own `date` field down to its UTC day, inside an
 * aggregation. Older rows may carry a time of day, so this cannot assume the
 * stored value is already midnight.
 */
const DAY_EXPR = {
    '$dateFromParts': {
        'year': { '$year': '$date' },
        'month': { '$month': '$date' },
        'day': { '$dayOfMonth': '$date' }
    }
};

/**
 * The stock engine.
 *
 * There is no stock collection to post to and nothing to add or subtract.
 * The confirmed purchases and sales are the record, so the only operation
 * here is RECALCULATE: for some products on some days, work out what those
 * documents now say, and rewrite the snapshot rows and the cached inventory
 * to match.
 *
 * That makes every write idempotent. Confirming, editing, unconfirming and
 * deleting all come down to the same call, because none of them has to know
 * what the stock used to be — only which products and which days need
 * looking at again.
 *
 * Callers pass a mongoose `session`: a recalculation writes the snapshots and
 * the product cache, and half of that would be a wrong stock figure.
 */
class StockEngine {

    /**
     * Resolved on use, not on construction: requiring this file must not
     * register schemas as a side effect.
     */
    get snapshots() {
        return new StockSnapshot().getInstance();
    }

    /**
     * Recalculate the given products on the given days, then rewrite their
     * cached inventory.
     *
     * @param { Object } scope
     * @param { * } scope.shop
     * @param { Array } scope.products - product ids to reconsider
     * @param { Array } scope.days - business dates to reconsider
     * @param { Object } session - a mongoose session, inside a transaction
     * @returns { Promise<Map<string, number>> } product id -> bottles on hand
     */
    async recalc( { shop, products, days }, session ) {
        const ids = [ ...new Set( ( products || [] ).map( String ) ) ];
        if ( !ids.length ) {
            return new Map();
        }
        const shopId = asId( shop );
        const productIds = ids.map( asId );

        // Deduplicated, normalised days. A bill carries one date, so an edit
        // reconsiders one day, or two when the date itself changed.
        const dayList = [ ...new Map(
            ( days || [] )
                .filter( ( d ) => d !== undefined && d !== null && d !== '' )
                .map( startOfDay )
                .map( ( d ) => [ d.getTime(), d ] )
        ).values() ];

        if ( dayList.length ) {
            const moved = await this.movementOn(
                shopId, productIds, dayList, session
            );

            // Replace the window being reconsidered: the rows go, and only
            // the days that still move get a row back.
            await this.snapshots.deleteMany( {
                'shop': shopId,
                'product': { '$in': productIds },
                'date': { '$in': dayList }
            }, { session } );

            const fresh = [];
            productIds.forEach( ( product ) => {
                dayList.forEach( ( date ) => {
                    const m = moved.get( key( product, date ) );
                    if ( !m ) return;
                    fresh.push( {
                        'shop': shopId,
                        product,
                        date,
                        'inQty': m.inQty,
                        'outQty': m.outQty,
                        'inAmount': money( m.inAmount ),
                        'outAmount': money( m.outAmount )
                    } );
                } );
            } );
            if ( fresh.length ) {
                await this.snapshots.insertMany( fresh, { session } );
            }
        }

        return this.refreshCache( shopId, productIds, session );
    }

    /**
     * What the confirmed documents say moved, per product per day.
     *
     * Read straight from the purchase and sale collections — they are the
     * record, and a draft is matched out, which is the whole meaning of a
     * draft not affecting stock.
     * @param { Object } shopId
     * @param { Array } productIds
     * @param { Array<Date> } dayList
     * @param { Object } [session]
     * @returns { Promise<Map<string, Object>> } keyed product|dayTime
     */
    async movementOn( shopId, productIds, dayList, session ) {
        const onOneOfTheDays = dayList.map( ( d ) => ( {
            'date': { '$gte': d, '$lt': new Date( d.getTime() + DAY ) }
        } ) );

        const pipeline = ( ) => [
            {
                '$match': {
                    'shop': shopId,
                    'status': 'confirmed',
                    '$or': onOneOfTheDays
                }
            },
            { '$unwind': '$items' },
            { '$match': { 'items.product': { '$in': productIds } } },
            {
                '$group': {
                    '_id': { 'product': '$items.product', 'date': DAY_EXPR },
                    'qty': { '$sum': '$items.qty' },
                    'amount': { '$sum': '$items.amount' }
                }
            }
        ];

        const Purchase = mongoose.model( 'purchase' );
        const Sale = mongoose.model( 'sale' );
        const [ bought, sold ] = await Promise.all( [
            Purchase.aggregate( pipeline() ).session( session || null ),
            Sale.aggregate( pipeline() ).session( session || null )
        ] );

        const out = new Map();
        const put = ( row, field, amountField ) => {
            const k = key( row._id.product, row._id.date );
            const at = out.get( k ) || {
                'inQty': 0, 'outQty': 0, 'inAmount': 0, 'outAmount': 0
            };
            at[ field ] += row.qty;
            at[ amountField ] += row.amount;
            out.set( k, at );
        };
        bought.forEach( ( r ) => put( r, 'inQty', 'inAmount' ) );
        sold.forEach( ( r ) => put( r, 'outQty', 'outAmount' ) );
        return out;
    }

    /**
     * Rewrite `product.inventory` from the snapshots — the sum of every day
     * the product has ever moved, with no date limit.
     *
     * Written, not incremented: after a recalculation the sum of the rows is
     * the only thing that can be right. A product with no rows left holds
     * nothing, and saying so is part of the repair.
     * @param { Object } shopId
     * @param { Array } productIds
     * @param { Object } [session]
     * @returns { Promise<Map<string, number>> }
     */
    async refreshCache( shopId, productIds, session ) {
        const rows = await this.snapshots.aggregate( [
            {
                '$match': {
                    'shop': shopId, 'product': { '$in': productIds }
                }
            },
            {
                '$group': {
                    '_id': '$product',
                    'onHand': {
                        '$sum': { '$subtract': [ '$inQty', '$outQty' ] }
                    }
                }
            }
        ] ).session( session || null );

        const onHand = new Map(
            rows.map( ( r ) => [ String( r._id ), r.onHand ] )
        );
        const Product = mongoose.model( 'product' );
        await Product.bulkWrite(
            productIds.map( ( product ) => ( {
                'updateOne': {
                    'filter': { '_id': product },
                    'update': {
                        '$set': {
                            'inventory': onHand.get( String( product ) ) || 0
                        }
                    }
                }
            } ) ),
            { session }
        );
        productIds.forEach( ( product ) => {
            const k = String( product );
            if ( !onHand.has( k ) ) onHand.set( k, 0 );
        } );
        return onHand;
    }

    /**
     * Stock on hand for some products, read from the snapshots.
     * @param { * } shop
     * @param { Array<string> } products
     * @param { Object } [session]
     * @returns { Promise<Map<string, number>> }
     */
    async onHand( shop, products, session ) {
        const ids = [ ...new Set( ( products || [] ).map( String ) ) ]
            .map( asId );
        if ( !ids.length ) {
            return new Map();
        }
        const rows = await this.snapshots.aggregate( [
            { '$match': { 'shop': asId( shop ), 'product': { '$in': ids } } },
            {
                '$group': {
                    '_id': '$product',
                    'onHand': {
                        '$sum': { '$subtract': [ '$inQty', '$outQty' ] }
                    }
                }
            }
        ] ).session( session || null );
        const map = new Map( ids.map( ( i ) => [ String( i ), 0 ] ) );
        rows.forEach( ( r ) => map.set( String( r._id ), r.onHand ) );
        return map;
    }

    /**
     * The products and days a document affects — the union of what it used to
     * say and what it says now, so a line that was removed, and a date it was
     * moved away from, are both reconsidered.
     * @param { Object } before - the stored document ( or null )
     * @param { Object } after - the document as it now stands ( or null )
     * @returns { { products: Array<string>, days: Array<Date> } }
     */
    footprint( before, after ) {
        const products = new Set();
        const days = [];
        [ before, after ].forEach( ( doc ) => {
            if ( !doc ) return;
            ( doc.items || [] ).forEach( ( it ) => {
                if ( it && it.product ) products.add( String( it.product ) );
            } );
            if ( doc.date ) days.push( doc.date );
        } );
        return { 'products': [ ...products ], days };
    }
}

/** One engine for the process: it holds models, not state. */
const stockEngine = new StockEngine();

module.exports = {
    StockEngine, stockEngine, startOfDay, endOfDayExclusive, money
};
