'use strict';
const { CalmController } = require( '../../../system/core/CalmController' );
const { CalmError } = require( '../../../system/core/CalmError' );
const { ProductService } = require( './product.service' );
const { Product } = require( './product.model' );
const productDTO = require( './product.dto' );
const autoBind = require( 'auto-bind' ),
    productService = new ProductService(
        new Product().getInstance()
    );

/** Filesystem-safe local date for download filenames, e.g. 2026-11-14. */
function fileStamp() {
    const d = new Date();
    const p = ( n ) => String( n ).padStart( 2, '0' );
    return `${ d.getFullYear() }-${ p( d.getMonth() + 1 ) }-${ p( d.getDate() ) }`;
}

class ProductController extends CalmController {

    constructor( service ) {
        super( service );
        this.dto = { ...this.dto, ...productDTO };
        autoBind( this );
    }

    /**
     * PUT /products/reorder
     * body: { items: [{ id, displayNumber }] } (or a bare array)
     * Persists the admin-arranged product ordering.
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

    /**
     * GET /products/template
     * Streams the .xlsx bulk-import template built by the service.
     */
    async downloadTemplate( req, res, next ) {
        try {
            const wb = await this.service.buildTemplateWorkbook();
            res.setHeader(
                'Content-Type',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            );
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="product-template_${ fileStamp() }.xlsx"`
            );
            await wb.xlsx.write( res );
            res.end();
        } catch ( e ) {
            next( e );
        }
    }

    /**
     * GET /products/export?shop=<id>
     * Streams an .xlsx export of the shop's products (same layout as the
     * template). Without ?shop it exports every shop.
     */
    async downloadItems( req, res, next ) {
        try {
            const wb = await this.service.buildItemsWorkbook( req.query.shop );
            res.setHeader(
                'Content-Type',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            );
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="products_${ fileStamp() }.xlsx"`
            );
            await wb.xlsx.write( res );
            res.end();
        } catch ( e ) {
            next( e );
        }
    }

    /**
     * GET /products/price-list?type=retailer|wholesale&shop=<id>
     * Streams a category-grouped price-list PDF for one shop.
     */
    async downloadPriceList( req, res, next ) {
        try {
            const type = req.query.type === 'wholesale' ? 'wholesale' : 'retailer';
            const pdf = await this.service.buildPriceListPdf( type, req.query.shop );
            res.setHeader( 'Content-Type', 'application/pdf' );
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="price-list-${ type }_${ fileStamp() }.pdf"`
            );
            res.send( pdf );
        } catch ( e ) {
            next( e );
        }
    }

    /**
     * POST /products/upload  (multipart, field "file")
     * Hands the uploaded workbook to the service for parsing and bulk insert.
     */
    async uploadTemplate( req, res, next ) {
        try {
            if ( !req.file ) {
                throw new CalmError( 'VALIDATION_ERROR', 'Template file is required.' );
            }
            const result = await this.service.importFromTemplate(
                req.file.buffer,
                req.user && req.user._id
            );
            res.sendCalmResponse( result, {
                'imported': true,
                'created': result.created,
                'failed': result.failed
            } );
        } catch ( e ) {
            next( e );
        }
    }

    /**
     * POST /products/update-prices  (multipart, field "file")
     * Updates product prices by _id from an exported-items file.
     */
    async uploadPrices( req, res, next ) {
        try {
            if ( !req.file ) {
                throw new CalmError( 'VALIDATION_ERROR', 'File is required.' );
            }
            const result = await this.service.updatePricesFromFile(
                req.file.buffer,
                req.user && req.user._id
            );
            res.sendCalmResponse( result, {
                'updated': result.updated,
                'failed': result.failed
            } );
        } catch ( e ) {
            next( e );
        }
    }

}

module.exports = new ProductController( productService );
