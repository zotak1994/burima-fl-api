'use strict';
const { CalmController } = require( '../../../system/core/CalmController' );
const { CompanyService } = require( './company.service' );
const { Company } = require( './company.model' );
const companyDTO = require( './company.dto' );
const autoBind = require( 'auto-bind' ),
    companyService = new CompanyService(
        new Company().getInstance()
    );

class CompanyController extends CalmController {

    constructor( service ) {
        super( service );
        this.dto = { ...this.dto, ...companyDTO };
        autoBind( this );
    }

    /**
     * PUT /companies/reorder
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

module.exports = new CompanyController( companyService );
