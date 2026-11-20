'use strict';
const { CalmController } = require( '../../../system/core/CalmController' );
const { ShopService } = require( './shop.service' );
const { Shop } = require( './shop.model' );
const shopDTO = require( './shop.dto' );
const autoBind = require( 'auto-bind' ),
    shopService = new ShopService(
        new Shop().getInstance()
    );

class ShopController extends CalmController {

    constructor( service ) {
        super( service );
        this.dto = { ...this.dto, ...shopDTO };
        autoBind( this );
    }

    /**
     * PUT /shops/reorder
     * body: { items: [{ id, displayNumber }] } (or a bare array)
     * Persists the admin-arranged ordering.
     */
    async reorder( req, res, next ) {
        try {
            const items = Array.isArray( req.body ) ? req.body : req.body.items;
            const response = await this.service.reorder( items );
            res.sendCalmResponse( null, { 'updated': response.data.updated } );
        } catch ( e ) {
            next( e );
        }
    }

}

module.exports = new ShopController( shopService );
