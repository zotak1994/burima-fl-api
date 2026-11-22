'use strict';

class GetDTO {
    constructor( { ...props } ) {
        this._id = props._id;
        this.shop = props.shop;
        this.invoiceNo = props.invoiceNo;
        this.passNo = props.passNo;
        this.date = props.date;
        this.items = props.items;
        this.totalQty = props.totalQty;
        this.totalAmount = props.totalAmount;
        this.lessRebate = props.lessRebate;
        this.specialPurpose = props.specialPurpose;
        this.roundOffToGovt = props.roundOffToGovt;
        this.tcs = props.tcs;
        this.roundOff = props.roundOff;
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
        this.invoiceNo = props.invoiceNo;
        this.passNo = props.passNo;
        this.date = props.date;
        this.items = props.items;
        this.totalQty = props.totalQty;
        this.totalAmount = props.totalAmount;
        this.lessRebate = props.lessRebate;
        this.specialPurpose = props.specialPurpose;
        this.roundOffToGovt = props.roundOffToGovt;
        this.tcs = props.tcs;
        // The entry screen does the arithmetic, so the figures it worked out
        // are stored as sent; each is still validated, and one left out is
        // computed from the rest.
        this.roundOff = props.roundOff;
        this.netAmount = props.netAmount;
        // `status` and the confirmation fields stay the service's: a purchase
        // is always created as a draft, and confirming has its own endpoint.
        this.createdBy = props.createdBy;
        Object.freeze( this );
    }
}

class UpdateDTO {
    constructor( { ...props } ) {
        this.invoiceNo = props.invoiceNo;
        this.passNo = props.passNo;
        this.date = props.date;
        this.items = props.items;
        this.totalQty = props.totalQty;
        this.totalAmount = props.totalAmount;
        this.lessRebate = props.lessRebate;
        this.specialPurpose = props.specialPurpose;
        this.roundOffToGovt = props.roundOffToGovt;
        this.tcs = props.tcs;
        // The entry screen does the arithmetic, so the figures it worked out
        // are stored as sent; each is still validated, and one left out is
        // computed from the rest.
        this.roundOff = props.roundOff;
        this.netAmount = props.netAmount;
        // `shop` is deliberately not updatable: moving a purchase between
        // outlets after the fact would strand the stock it posted.
        // `status` is not updatable either — confirming goes through its own
        // endpoint so stock can be posted in the same operation.
        this.updatedBy = props.updatedBy;
        // Delete Fields which are not present in data
        Object.keys( this ).forEach( key => {
            if ( this[ key ] === undefined ) {
                delete this[ key ];
            }
        } );
        Object.freeze( this );
    }
}

module.exports = { GetDTO, InsertDTO, UpdateDTO };
