'use strict';
const mongoose = require( 'mongoose' );
const { CalmService } = require( '../../../system/core/CalmService' );
const { CalmError } = require( '../../../system/core/CalmError' );
const { stockEngine } = require( '../stock/stock.engine' );
const {
    money, normaliseLines, assertNotFutureDate
} = require( '../stock/stock-lines' );

class SaleService extends CalmService {
    // Setting Global Populate to apply in Get All & Get Single
    populateFields = [
        { path: 'shop', select: 'name phone displayNumber' },
        { path: 'items.product', select: 'name code mainUnit alternateUnit' },
        { path: 'createdBy', select: 'name email' },
        { path: 'confirmedBy', select: 'name email' }
    ];
    // Nothing on a sale is text any more, so there is nothing to search:
    // the listing filters by shop, status and date instead.
    searchFields = [];

    constructor( model ) {
        super( model );
    }

    /**
     * Newest first by default: a sales screen is about what just went out.
     */
    async getAll( query, ops = {} ) {
        if ( !query.sortBy && !query.sort ) {
            // eslint-disable-next-line no-param-reassign
            query = { ...query, sortBy: { 'date': -1, 'createdAt': -1 } };
        }
        return super.getAll( query, ops );
    }

    /**
     * Validate the lines and work out the totals.
     *
     * A sale is priced at the MRP, so a line that names no rate takes the
     * product's — and its amount is then the MRP times the quantity. The bill
     * is the sum of the lines and nothing else: no discount, no round off.
     * @param { Array } items
     * @param { * } shopId
     * @param { Object } [totals]
     */
    async normaliseItems( items, shopId, totals = {} ) {
        return normaliseLines( {
            items, shopId, totals, 'fallbackRate': 'mrp'
        } );
    }

    /** The bill: the lines added up. */
    bill( totals ) {
        return {
            'totalQty': totals.totalQty,
            'totalAmount': totals.totalAmount,
            'netAmount': money( totals.totalAmount )
        };
    }

    /** Create a sale. Always a draft — no stock leaves yet. */
    async insert( data ) {
        const payload = { ...data };
        assertNotFutureDate( payload.date, 'sale' );
        const totals = await this.normaliseItems(
            payload.items, payload.shop, payload
        );
        payload.items = totals.items;
        Object.assign( payload, this.bill( totals ) );
        payload.status = 'draft';
        return super.insert( payload );
    }

    /**
     * Edit a sale — a draft, or a confirmed one.
     *
     * A confirmed sale has already taken stock out, and an admin still has to
     * be able to correct it: change a quantity either way, remove a line, add
     * one, or move the bill to another date. The edit is applied and the stock
     * is worked out again in one transaction, for every product either version
     * of the bill mentions and on both dates — so a line dropped from the bill
     * has its bottles put back, and correcting a June bill in August repairs
     * June's figures too. A correction that would oversell is refused, which
     * rolls the whole thing back.
     */
    async update( id, data ) {
        // The lines and the date come along so the stock side knows what this
        // bill used to say.
        const current = await this.model.findById( id )
            .select( 'status shop date items totalAmount' )
            .lean();
        if ( !current ) {
            throw new CalmError( 'NOT_FOUND_ERROR', 'Sale not found.' );
        }
        const payload = { ...data };
        assertNotFutureDate( payload.date, 'sale' );
        if ( payload.items !== undefined ) {
            const totals = await this.normaliseItems(
                payload.items, current.shop, payload
            );
            payload.items = totals.items;
            Object.assign( payload, this.bill( totals ) );
        }

        if ( current.status !== 'confirmed' ) {
            return super.update( id, payload );
        }

        if ( payload.items !== undefined && !payload.items.length ) {
            throw new CalmError(
                'VALIDATION_ERROR',
                'A confirmed sale cannot be left with no lines. '
                + 'Unconfirm it first.'
            );
        }

        const session = await mongoose.startSession();
        try {
            let out = null;
            await session.withTransaction( async () => {
                const saved = await this.model.findByIdAndUpdate(
                    id,
                    { ...payload },
                    {
                        'new': true,
                        'runValidators': true,
                        'context': 'query',
                        session
                    }
                );
                if ( !saved ) {
                    throw new CalmError( 'NOT_FOUND_ERROR', 'Sale not found.' );
                }
                const onHand = await stockEngine.recalc( {
                    'shop': saved.shop,
                    ...stockEngine.footprint( current, saved )
                }, session );
                this.assertNotOversold( saved, onHand );
                out = {
                    'data': this.parseObj( saved ),
                    'recalculated': onHand.size
                };
            } );
            return out;
        } finally {
            await session.endSession();
        }
    }

    /** Only drafts can be deleted; a confirmed sale is a stock record. */
    async delete( id ) {
        const current = await this.model.findById( id ).select( 'status' ).lean();
        if ( current && current.status === 'confirmed' ) {
            throw new CalmError(
                'VALIDATION_ERROR',
                'This sale is confirmed and can no longer be deleted. '
                + 'Unconfirm it first, which puts the stock back.'
            );
        }
        return super.delete( id );
    }

    /**
     * Refuse a sale that leaves a product below zero.
     *
     * Checked against the figures the recalculation just produced, not the
     * stock before it: inside the transaction the sale is already counted, so
     * this is the stock that would actually result. Throwing rolls the whole
     * thing back, which is why it is safe to check afterwards.
     * @param { Object } sale - the saved document
     * @param { Map<string, number> } onHand - what recalc worked out
     */
    assertNotOversold( sale, onHand ) {
        const short = [];
        ( sale.items || [] ).forEach( ( it ) => {
            const left = onHand.get( String( it.product ) );
            if ( left !== undefined && left < 0 ) {
                short.push( `${ it.name || 'product' } would go to ${ left }` );
            }
        } );
        if ( short.length ) {
            throw new CalmError(
                'VALIDATION_ERROR',
                `Not enough stock: ${ [ ...new Set( short ) ].join( '; ' ) }.`
            );
        }
    }

    /**
     * Confirm a draft, which is what takes its bottles off the shelf: the sale
     * becomes confirmed and the stock for its products on its date is worked
     * out again.
     *
     * The status is claimed first with a conditional update, so two clicks
     * cannot take the same stock out twice. Everything runs in one
     * transaction, and a line that would oversell aborts all of it.
     * @param { string } id
     * @param { string } [userId]
     */
    async confirm( id, userId ) {
        const session = await mongoose.startSession();
        try {
            let out = null;
            await session.withTransaction( async () => {
                const claimed = await this.model.findOneAndUpdate(
                    { '_id': id, 'status': 'draft' },
                    {
                        '$set': {
                            'status': 'confirmed',
                            'confirmedAt': new Date(),
                            'confirmedBy': userId
                        }
                    },
                    { 'new': true, session }
                );

                if ( !claimed ) {
                    const exists = await this.model.findById( id )
                        .select( 'status' ).session( session ).lean();
                    if ( !exists ) {
                        throw new CalmError( 'NOT_FOUND_ERROR', 'Sale not found.' );
                    }
                    throw new CalmError(
                        'VALIDATION_ERROR', 'This sale is already confirmed.'
                    );
                }

                if ( !claimed.items.length ) {
                    throw new CalmError(
                        'VALIDATION_ERROR',
                        'Add at least one product before confirming.'
                    );
                }

                const onHand = await stockEngine.recalc( {
                    'shop': claimed.shop,
                    ...stockEngine.footprint( null, claimed )
                }, session );
                this.assertNotOversold( claimed, onHand );

                out = {
                    'data': this.parseObj( claimed ),
                    'destocked': onHand.size,
                    'totalQty': claimed.totalQty
                };
            } );
            return out;
        } finally {
            await session.endSession();
        }
    }

    /**
     * Take a confirmed sale back to draft and put the stock back: once it is a
     * draft the stock calculation stops counting it, so its products are
     * simply worked out again.
     * @param { string } id
     * @param { string } [userId]
     */
    async unconfirm( id, userId ) {
        const session = await mongoose.startSession();
        try {
            let out = null;
            await session.withTransaction( async () => {
                const claimed = await this.model.findOneAndUpdate(
                    { '_id': id, 'status': 'confirmed' },
                    {
                        '$set': { 'status': 'draft', 'updatedBy': userId },
                        '$unset': { 'confirmedAt': 1, 'confirmedBy': 1 }
                    },
                    { 'new': true, session }
                );
                if ( !claimed ) {
                    const exists = await this.model.findById( id )
                        .select( 'status' ).session( session ).lean();
                    if ( !exists ) {
                        throw new CalmError( 'NOT_FOUND_ERROR', 'Sale not found.' );
                    }
                    throw new CalmError(
                        'VALIDATION_ERROR', 'This sale is not confirmed.'
                    );
                }
                const onHand = await stockEngine.recalc( {
                    'shop': claimed.shop,
                    ...stockEngine.footprint( null, claimed )
                }, session );
                out = {
                    'data': this.parseObj( claimed ),
                    'restocked': onHand.size
                };
            } );
            return out;
        } finally {
            await session.endSession();
        }
    }
}

module.exports = { SaleService };
