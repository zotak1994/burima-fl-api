'use strict';
const { CalmController } = require( '../../../system/core/CalmController' );
const { CapacityService } = require( './capacity.service' );
const { Capacity } = require( './capacity.model' );
const capacityDTO = require( './capacity.dto' );
const autoBind = require( 'auto-bind' ),
    capacityService = new CapacityService(
        new Capacity().getInstance()
    );

class CapacityController extends CalmController {

    constructor( service ) {
        super( service );
        this.dto = { ...this.dto, ...capacityDTO };
        autoBind( this );
    }

    /**
     * PUT /capacities/reorder
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

module.exports = new CapacityController( capacityService );
