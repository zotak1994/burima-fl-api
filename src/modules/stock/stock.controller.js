'use strict';
const { CalmController } = require( '../../../system/core/CalmController' );
const { StockService } = require( './stock.service' );
const { Stock } = require( './stock.model' );
const stockDTO = require( './stock.dto' );
const autoBind = require( 'auto-bind' ),
    stockService = new StockService(
        new Stock().getInstance()
    );

/**
 * The stock report is read-only over HTTP. Stock moves by confirming a purchase or a
 * sale, never by posting here — the one write endpoint is the rebuild, which
 * recomputes the snapshots from the documents and cannot invent stock.
 *
 * Anything beyond totalCount / hasNext goes in `metaData`: the response
 * envelope passes through only the keys it knows, so a figure sent as a
 * top-level option would be dropped on the way out.
 */
class StockController extends CalmController {

    constructor( service ) {
        super( service );
        this.dto = { ...this.dto, ...stockDTO };
        autoBind( this );
    }

    /** GET /stock — one row per product for the window. */
    async report( req, res, next ) {
        try {
            const result = await this.service.report( req.query );
            res.sendCalmResponse( result.rows, {
                'totalCount': result.totalCount,
                'hasNext': result.hasNext,
                'metaData': {
                    'from': result.from,
                    'to': result.to,
                    'totals': result.totals
                }
            } );
        } catch ( e ) {
            next( e );
        }
    }

    /** GET /stock/totals — the window in one row. */
    async totals( req, res, next ) {
        try {
            res.sendCalmResponse( await this.service.totals( req.query ) );
        } catch ( e ) {
            next( e );
        }
    }

    /** GET /stock/movements — the documents behind the figures. */
    async movements( req, res, next ) {
        try {
            const result = await this.service.movements( req.query );
            res.sendCalmResponse( result.rows, {
                'totalCount': result.totalCount,
                'hasNext': result.hasNext
            } );
        } catch ( e ) {
            next( e );
        }
    }

    /** POST /stock/rebuild — recompute the snapshots from the documents. */
    async rebuild( req, res, next ) {
        try {
            const result = await this.service.rebuild( {
                ...req.query, ...req.body
            } );
            res.sendCalmResponse( result, { 'updated': true } );
        } catch ( e ) {
            next( e );
        }
    }
}

module.exports = new StockController( stockService );
