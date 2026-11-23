'use strict';
const mongoose = require( 'mongoose' );
const dayjs = require( '../../utils/day' );
const { CalmService } = require( '../../../system/core/CalmService' );
const { CalmError } = require( '../../../system/core/CalmError' );
const { stockEngine, startOfDay, money } = require( './stock.engine' );

const asId = ( v ) => new mongoose.Types.ObjectId( String( v ) );

/** Group a document's own `date` down to its UTC day inside a pipeline. */
const DAY_EXPR = {
    '$dateFromParts': {
        'year': { '$year': '$date' },
        'month': { '$month': '$date' },
        'day': { '$dayOfMonth': '$date' }
    }
};

/**
 * Read the window a query asks for. Both ends are inclusive calendar days,
 * because that is how a stock report is read out loud — "1st June to 5th
 * August" includes the 5th.
 * @param { Object } query
 * @returns { { from: Date, to: Date } }
 */
function readRange( query ) {
    if ( !query.from && !query.to && !query.date ) {
        throw new CalmError(
            'VALIDATION_ERROR',
            'A stock report needs a date range: send from and to, or date.'
        );
    }
    // ?date=YYYY-MM-DD is the single-day shorthand.
    if ( query.date ) {
        const day = startOfDay( query.date );
        return { 'from': day, 'to': day };
    }
    const from = startOfDay( query.from || query.to );
    const to = startOfDay( query.to || query.from );
    if ( to < from ) {
        throw new CalmError(
            'VALIDATION_ERROR', 'The stock range ends before it starts.'
        );
    }
    return { from, to };
}

/** An inclusive day range as the exclusive-upper bound a query needs. */
const matchRange = ( from, to ) => ( {
    '$gte': from, '$lt': dayjs.utc( to ).add( 1, 'day' ).toDate()
} );

/**
 * The stock report's read side — every figure on it comes from the daily
 * snapshots, added up two ways:
 *
 *   opening  = everything before the window started
 *   movement = everything inside it
 *
 * There is no running balance stored anywhere, so a row cannot disagree with
 * the documents behind it.
 */
class StockService extends CalmService {

    constructor( model ) {
        super( model );
        this.engine = stockEngine;
    }

    /**
     * Opening balance per product at the start of a window: everything the
     * product moved before that date, netted off.
     *
     * A product that never moved is simply absent, and its opening is zero.
     * @param { * } shop
     * @param { Date } from
     * @param { Array } [products] - narrow to these ids
     * @returns { Promise<Map<string, number>> }
     */
    async openingsAt( shop, from, products ) {
        const match = { 'shop': asId( shop ), 'date': { '$lt': from } };
        if ( products && products.length ) {
            match.product = { '$in': products.map( asId ) };
        }
        const rows = await this.model.aggregate( [
            { '$match': match },
            {
                '$group': {
                    '_id': '$product',
                    'opening': {
                        '$sum': { '$subtract': [ '$inQty', '$outQty' ] }
                    }
                }
            }
        ] );
        return new Map( rows.map( ( r ) => [ String( r._id ), r.opening ] ) );
    }

    /**
     * What moved inside a window, per product.
     * @param { * } shop
     * @param { Date } from
     * @param { Date } to
     * @param { Array } [products]
     * @returns { Promise<Map<string, Object>> }
     */
    async movedIn( shop, from, to, products ) {
        const match = { 'shop': asId( shop ), 'date': matchRange( from, to ) };
        if ( products && products.length ) {
            match.product = { '$in': products.map( asId ) };
        }
        const rows = await this.model.aggregate( [
            { '$match': match },
            {
                '$group': {
                    '_id': '$product',
                    'inQty': { '$sum': '$inQty' },
                    'outQty': { '$sum': '$outQty' },
                    'inAmount': { '$sum': '$inAmount' },
                    'outAmount': { '$sum': '$outAmount' },
                    'days': { '$sum': 1 }
                }
            }
        ] );
        return new Map( rows.map( ( r ) => [ String( r._id ), r ] ) );
    }

    /**
     * The products a query is asking about, as a mongo filter.
     *
     * The same filters the catalogue uses, so stock can be read one company
     * or one measurement at a time.
     * @param { Object } query
     * @param { Object } shop - the shop's ObjectId
     * @returns { Object }
     */
    catalogueFilter( query, shop ) {
        const filter = { 'shop': shop };
        [ 'category', 'motherCategory', 'company', 'capacity', 'product' ]
            .forEach( ( k ) => {
                const val = query[ k ];
                if ( val && mongoose.Types.ObjectId.isValid( val ) ) {
                    filter[ k === 'product' ? '_id' : k ] = asId( val );
                }
            } );
        if ( query.search ) {
            const term = String( query.search ).trim();
            if ( term ) {
                filter.$or = [
                    { 'name': { '$regex': term, '$options': 'i' } },
                    { 'code': { '$regex': term, '$options': 'i' } }
                ];
            }
        }
        return filter;
    }

    /**
     * Which products a query narrows to, or null for the whole outlet.
     *
     * Null matters: with no filter there is nothing to look up and the
     * figures can be read straight off the snapshots. It is only when a
     * filter IS set that the product ids have to be resolved first — which is
     * what makes the totals agree with the rows they sit above.
     * @param { Object } query
     * @param { Object } shop
     * @returns { Promise<Array<string>|null> }
     */
    async narrowTo( query, shop ) {
        const filter = this.catalogueFilter( query, shop );
        // Only 'shop' means no narrowing at all.
        if ( Object.keys( filter ).length === 1 ) {
            return null;
        }
        const Product = mongoose.model( 'product' );
        const found = await Product.find( filter ).select( '_id' ).lean();
        return found.map( ( p ) => String( p._id ) );
    }

    /**
     * The stock report: one row per product, with the opening balance, what
     * came in, what went out and what is left.
     *
     * Paged over the shop's products rather than over the snapshots, so a
     * product that did not move in the window still shows the stock it is
     * holding — which is the whole point of an in-hand column.
     * @param { Object } query - shop, from, to | date, product, search,
     *                           category / company / capacity, skip, limit
     * @returns { Promise<Object> } rows plus the window's totals
     */
    async report( query ) {
        if ( !query.shop ) {
            throw new CalmError(
                'VALIDATION_ERROR', 'A stock report needs a shop.'
            );
        }
        const { from, to } = readRange( query );
        const shop = asId( query.shop );
        const Product = mongoose.model( 'product' );

        const skip = query.skip ? Number( query.skip ) : 0;
        const limit = query.limit ? Number( query.limit ) : 100;

        const filter = this.catalogueFilter( query, shop );

        const totalCount = await Product.countDocuments( filter );
        const products = await Product.find( filter )
            .select(
                'name code mrp purchasePrice inventory stockAlertQty '
                + 'mainUnit alternateUnit perAlternateUnitQty'
            )
            .sort( { 'name': 1 } )
            .collation( { 'locale': 'en', 'strength': 2 } )
            .skip( skip )
            .limit( limit )
            .lean();

        const ids = products.map( ( p ) => String( p._id ) );
        const [ openings, moved ] = await Promise.all( [
            this.openingsAt( shop, from, ids ),
            this.movedIn( shop, from, to, ids )
        ] );

        const rows = products.map( ( p ) => {
            const k = String( p._id );
            const opening = openings.get( k ) || 0;
            const m = moved.get( k ) || {};
            const inQty = m.inQty || 0;
            const outQty = m.outQty || 0;
            const closing = opening + inQty - outQty;
            const mrp = money( p.mrp || 0 );
            return {
                'product': { '_id': p._id, 'name': p.name, 'code': p.code },
                'mrp': mrp,
                'stockAlertQty': p.stockAlertQty,
                // Bottles per case, so the reader can show the shelf the way
                // it is stacked. Zero or one means the product is not cased.
                'perCase': Number( p.perAlternateUnitQty ) || 0,
                'mainUnit': p.mainUnit,
                'alternateUnit': p.alternateUnit,
                // A: what it was holding when the window opened.
                opening,
                // B: everything that came in during the window.
                'purchaseQty': inQty,
                'purchaseAmount': money( m.inAmount || 0 ),
                // D: everything that went out.
                'saleQty': outQty,
                'saleAmount': money( m.outAmount || 0 ),
                // C = A + B: everything that was available in the window.
                'totalQty': opening + inQty,
                // E = C - D: in hand at the end of the window. For a window
                // ending today this is the stock on the shelf.
                'closing': closing,
                // G = F x E: what is in hand, valued at MRP.
                'stockValue': money( mrp * closing ),
                // H = F x D: what went out, valued at MRP. Not the same thing
                // as saleAmount above, which is what the bills charged.
                'saleValue': money( mrp * outQty )
            };
        } );

        return {
            'from': from,
            'to': to,
            'rows': rows,
            'totalCount': totalCount,
            'hasNext': skip + products.length < totalCount,
            'totals': await this.totals( query )
        };
    }

    /**
     * The window's figures for the whole shop, in one row.
     *
     * The money columns are valued per product and then added up, never by
     * multiplying a total quantity by anything: a shop's bottles do not share
     * one MRP.
     * @param { Object } query - shop, from, to | date, and the same
     *                            catalogue filters the report takes
     * @returns { Promise<Object> }
     */
    async totals( query ) {
        if ( !query.shop ) {
            throw new CalmError(
                'VALIDATION_ERROR', 'A stock report needs a shop.'
            );
        }
        const { from, to } = readRange( query );
        const shop = asId( query.shop );

        // Narrowed to whatever the report is showing — one product, one
        // company, a search — so the tiles describe the rows beneath them and
        // not the whole outlet. Null means no filter, which is the whole
        // outlet and needs no lookup.
        const only = await this.narrowTo( query, shop );
        if ( only && !only.length ) {
            return {
                'from': from, 'to': to, 'opening': 0,
                'purchaseQty': 0, 'purchaseAmount': 0,
                'saleQty': 0, 'saleAmount': 0,
                'totalQty': 0, 'closing': 0,
                'stockValue': 0, 'saleValue': 0
            };
        }

        const [ openings, moved ] = await Promise.all( [
            this.openingsAt( shop, from, only ),
            this.movedIn( shop, from, to, only )
        ] );

        const opening = [ ...openings.values() ].reduce( ( s, v ) => s + v, 0 );
        let inQty = 0;
        let outQty = 0;
        let inAmount = 0;
        let outAmount = 0;
        moved.forEach( ( m ) => {
            inQty += m.inQty;
            outQty += m.outQty;
            inAmount += m.inAmount;
            outAmount += m.outAmount;
        } );

        // Valuing the window needs each product's own MRP. Only the products
        // that actually appear are looked up; one holding nothing adds nothing.
        const touched = only
            ? only.map( String )
            : [ ...new Set( [ ...openings.keys(), ...moved.keys() ] ) ];
        let stockValue = 0;
        let saleValue = 0;
        if ( touched.length ) {
            const Product = mongoose.model( 'product' );
            const priced = await Product
                .find( { '_id': { '$in': touched.map( asId ) } } )
                .select( 'mrp' )
                .lean();
            priced.forEach( ( p ) => {
                const k = String( p._id );
                const m = moved.get( k ) || {};
                const out = m.outQty || 0;
                const close = ( openings.get( k ) || 0 )
                    + ( m.inQty || 0 ) - out;
                const mrp = money( p.mrp || 0 );
                stockValue += mrp * close;
                saleValue += mrp * out;
            } );
        }

        return {
            'from': from,
            'to': to,
            opening,
            'purchaseQty': inQty,
            'purchaseAmount': money( inAmount ),
            'saleQty': outQty,
            'saleAmount': money( outAmount ),
            'totalQty': opening + inQty,
            'closing': opening + inQty - outQty,
            'stockValue': money( stockValue ),
            'saleValue': money( saleValue )
        };
    }

    /**
     * Every line behind a window, newest first: which bill moved what. This
     * is the drill-down for "why does this say 48".
     *
     * Read from the purchase and sale documents themselves — there is no
     * movement collection to read instead, and these are the record.
     * @param { Object } query - shop, from, to | date, product, kind
     * @returns { Promise<Object> }
     */
    async movements( query ) {
        if ( !query.shop ) {
            throw new CalmError(
                'VALIDATION_ERROR', 'A stock report needs a shop.'
            );
        }
        const { from, to } = readRange( query );
        const shop = asId( query.shop );
        const product = query.product
            && mongoose.Types.ObjectId.isValid( query.product )
            ? asId( query.product )
            : null;
        const skip = query.skip ? Number( query.skip ) : 0;
        const limit = query.limit ? Number( query.limit ) : 100;

        const Purchase = mongoose.model( 'purchase' );
        const Sale = mongoose.model( 'sale' );

        /**
         * One document's lines, flattened to stock movements. `docNoField` is
         * the field that names the document, which only a purchase has — a
         * sale is identified by its date and its id.
         */
        const lines = ( kind, direction, docNoField ) => {
            const stages = [
                {
                    '$match': {
                        'shop': shop,
                        'status': 'confirmed',
                        'date': matchRange( from, to )
                    }
                },
                { '$unwind': '$items' }
            ];
            if ( product ) {
                stages.push( { '$match': { 'items.product': product } } );
            }
            const projection = {
                '_id': 0,
                'source': '$_id',
                'kind': { '$literal': kind },
                'date': 1,
                'product': '$items.product',
                'name': '$items.name',
                // Signed, so a reader can add the column up.
                'qty': { '$multiply': [ direction, '$items.qty' ] },
                'rate': '$items.rate',
                'amount': '$items.amount'
            };
            if ( docNoField ) {
                projection.docNo = `$${ docNoField }`;
            }
            stages.push( { '$project': projection } );
            return stages;
        };

        const wanted = query.kind ? String( query.kind ) : null;
        let pipeline;
        if ( wanted === 'sale' ) {
            pipeline = lines( 'sale', -1, null );
        } else {
            pipeline = lines( 'purchase', 1, 'invoiceNo' );
            if ( wanted !== 'purchase' ) {
                pipeline.push( {
                    '$unionWith': {
                        'coll': Sale.collection.name,
                        'pipeline': lines( 'sale', -1, null )
                    }
                } );
            }
        }

        const base = wanted === 'sale' ? Sale : Purchase;
        const [ out ] = await base.aggregate( [
            ...pipeline,
            {
                '$facet': {
                    'rows': [
                        { '$sort': { 'date': -1, 'source': -1 } },
                        { '$skip': skip },
                        { '$limit': limit },
                        {
                            // A plain lookup, deliberately without an inner
                            // pipeline: the concise correlated form needs
                            // MongoDB 5.0, and this has to work anywhere.
                            '$lookup': {
                                'from': mongoose.model( 'product' )
                                    .collection.name,
                                'localField': 'product',
                                'foreignField': '_id',
                                'as': 'productDoc'
                            }
                        },
                        {
                            '$addFields': {
                                'product': {
                                    '$let': {
                                        'vars': {
                                            'p': { '$arrayElemAt': [ '$productDoc', 0 ] }
                                        },
                                        'in': {
                                            '$cond': [
                                                { '$ifNull': [ '$$p', false ] },
                                                {
                                                    '_id': '$$p._id',
                                                    'name': '$$p.name',
                                                    'code': '$$p.code'
                                                },
                                                '$product'
                                            ]
                                        }
                                    }
                                }
                            }
                        },
                        { '$project': { 'productDoc': 0 } }
                    ],
                    'count': [ { '$count': 'n' } ]
                }
            }
        ] );

        const rows = out ? out.rows : [];
        const totalCount = out && out.count.length ? out.count[ 0 ].n : 0;
        return {
            'rows': rows,
            'totalCount': totalCount,
            'hasNext': skip + rows.length < totalCount
        };
    }

    /**
     * Throw the snapshots away and work them out again from the confirmed
     * purchases and sales.
     *
     * Those documents are the record, so this is always safe and always
     * correct — it is the repair for a figure that looks wrong, and the way
     * to populate the snapshots the first time. Scoped to one shop, and to
     * one product when given.
     * @param { Object } query - shop, product
     * @returns { Promise<Object> }
     */
    async rebuild( query ) {
        if ( !query.shop ) {
            throw new CalmError( 'VALIDATION_ERROR', 'A rebuild needs a shop.' );
        }
        const shop = asId( query.shop );
        const one = query.product
            && mongoose.Types.ObjectId.isValid( query.product )
            ? asId( query.product )
            : null;

        const Product = mongoose.model( 'product' );
        const Purchase = mongoose.model( 'purchase' );
        const Sale = mongoose.model( 'sale' );

        // Every product in view, so one that no longer has a document behind
        // it is zeroed rather than keeping whatever it last said.
        const products = one
            ? [ one ]
            : ( await Product.find( { 'shop': shop } ).select( '_id' ).lean() )
                .map( ( p ) => p._id );

        // Every day the shop has a confirmed document for.
        const daysOf = async ( Model ) => ( await Model.aggregate( [
            { '$match': { 'shop': shop, 'status': 'confirmed' } },
            { '$group': { '_id': DAY_EXPR } }
        ] ) ).map( ( r ) => r._id );
        const [ buyDays, sellDays ] = await Promise.all( [
            daysOf( Purchase ), daysOf( Sale )
        ] );
        const days = [ ...buyDays, ...sellDays ];

        const session = await mongoose.startSession();
        try {
            let onHand = new Map();
            await session.withTransaction( async () => {
                // Start from nothing: a leftover row for a day that no longer
                // has a document is exactly the drift this is here to fix.
                await this.model.deleteMany( {
                    'shop': shop, 'product': { '$in': products }
                }, { session } );
                onHand = await this.engine.recalc( {
                    'shop': shop,
                    'products': products.map( String ),
                    days
                }, session );
            } );
            return {
                'products': products.length,
                'days': [ ...new Set(
                    days.map( ( d ) => dayjs.utc( d ).valueOf() )
                ) ].length,
                'onHand': [ ...onHand.entries() ]
                    .filter( ( [ , v ] ) => v !== 0 )
                    .map( ( [ product, qty ] ) => ( { product, qty } ) )
            };
        } finally {
            await session.endSession();
        }
    }
}

module.exports = { StockService };
