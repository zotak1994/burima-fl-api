'use strict';
const mongoose = require( 'mongoose' );
const { Schema } = require( 'mongoose' );
const uniqueValidator = require( 'mongoose-unique-validator' );
const { toAmount } = require( '../../utils' );

class Product {

    initSchema() {
        const schema = new Schema( {
            'name': {
                'type': String,
                'required': true,
                'trim': true
            },
            'code': {
                // The shop's own product code / SKU. Optional, so existing
                // rows and partial bulk imports stay valid. Stored upper-case
                // and trimmed, and unique within a shop when set (see the
                // partial index below).
                'type': String,
                'trim': true,
                'uppercase': true
            },
            'shop': {
                // The outlet this product belongs to. Every product is owned by
                // exactly one shop; sell and purchase orders will hang off the
                // same ref.
                'type': Schema.Types.ObjectId,
                'ref': 'shop',
                'required': true,
                'index': true
            },
            'category': {
                'type': Schema.Types.ObjectId,
                'ref': 'category',
                'required': true
            },
            'motherCategory': {
                'type': Schema.Types.ObjectId,
                'ref': 'mothercategory',
                'required': true,
                'index': true
            },
            // Optional in the schema so existing rows stay valid, though the
            // admin form does ask for it.
            'company': {
                'type': Schema.Types.ObjectId,
                'ref': 'company',
                'index': true
            },
            'capacity': {
                // Bottle size.
                'type': Schema.Types.ObjectId,
                'ref': 'capacity',
                'required': true,
                'index': true
            },
            'mrp': {
                // Maximum retail price.
                'type': Number,
                'required': true,
                'min': 0,
                'set': toAmount
            },
            'purchasePrice': {
                // What the product costs to buy in.
                'type': Number,
                'required': true,
                'min': 0,
                'set': toAmount
            },
            'mainUnit': {
                // The unit the product is stocked and priced in.
                'type': String,
                'enum': [ 'BOTTLE' ],
                'default': 'BOTTLE',
                'uppercase': true,
                'trim': true
            },
            'alternateUnit': {
                // The larger pack the product ships in.
                'type': String,
                'enum': [ 'CASE' ],
                'default': 'CASE',
                'uppercase': true,
                'trim': true
            },
            'perAlternateUnitQty': {
                // How many main units make up one alternate unit.
                'type': Number,
                'required': true,
                'min': 1,
                'default': 1
            },
            'stockAlertQty': {
                // Stock at or below this level counts as low.
                'type': Number,
                'required': true,
                'min': 0,
                'default': 0
            },
            'inventory': {
                // Stock on hand. Owned by the server: the admin product form
                // reads it but never submits it.
                'type': Number,
                'required': true,
                'min': 0,
                'default': 0
            },
            'displayNumber': {
                'type': Number,
                'default': 0,
                'index': true
            },
            'status': {
                'type': Boolean,
                'default': true
            },
            'createdBy': {
                'type': Schema.Types.ObjectId,
                'ref': 'user'
            },
            'updatedBy': {
                'type': Schema.Types.ObjectId,
                'ref': 'user'
            }
        }, { 'timestamps': true } );

        schema.plugin( uniqueValidator, { 'message': '{PATH} already exists' } );
        // A code is unique per SHOP, not globally: separate outlets keep their
        // own numbering and will legitimately reuse the same codes. The partial
        // filter is what allows any number of products to carry no code at all
        // — a plain unique index treats every missing value as the same null
        // and would reject the second code-less product. The service checks for
        // clashes first so the admin gets a readable message; this index is the
        // backstop for concurrent writes.
        schema.index(
            { 'shop': 1, 'code': 1 },
            {
                'unique': true,
                'partialFilterExpression': { 'code': { '$type': 'string' } }
            }
        );
        try {
            mongoose.model( 'product', schema );
        } catch ( e ) {

        }

    }

    getInstance() {
        this.initSchema();
        return mongoose.model( 'product' );
    }
}

module.exports = { Product };
