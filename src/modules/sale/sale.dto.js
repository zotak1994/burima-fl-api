'use strict';

class GetDTO {
    constructor( { ...props } ) {
        this._id = props._id;
        this.shop = props.shop;
        this.date = props.date;
        this.items = props.items;
        this.totalQty = props.totalQty;
        this.totalAmount = props.totalAmount;
        this.netAmount = props.netAmount;
        this.status = props.status;
        this.confirmedAt = props.confirmedAt;
        this.confirmedBy = props.confirmedBy;

        // Auto Generated Fields
        this.createdBy = props.createdBy;
        this.updatedBy = props.updatedBy;
        this.createdAt = props.createdAt;
        this.updatedAt = props.updatedAt;
        Object.freeze( this );
    }
}

class InsertDTO {
    constructor( { ...props } ) {
        this.shop = props.shop;
        this.date = props.date;
        this.items = props.items;
        this.totalQty = props.totalQty;
        this.totalAmount = props.totalAmount;
        // `status` and the confirmation fields stay the service's: a sale is
        // always created as a draft, and confirming has its own endpoint.
        this.createdBy = props.createdBy;
        Object.freeze( this );
    }
}

class UpdateDTO {
    constructor( { ...props } ) {
        this.date = props.date;
        this.items = props.items;
        this.totalQty = props.totalQty;
        this.totalAmount = props.totalAmount;
        // `netAmount` is the service's own: a bill is its lines added up, so
        // there is nothing for a client to settle.
        // `shop` is deliberately not updatable: moving a sale between outlets
        // after the fact would strand the stock it took out.
        this.updatedBy = props.updatedBy;
        // Delete Fields which are not present in data
        Object.keys( this ).forEach( ( key ) => {
            if ( this[ key ] === undefined ) {
                delete this[ key ];
            }
        } );
        Object.freeze( this );
    }
}

module.exports = { GetDTO, InsertDTO, UpdateDTO };
