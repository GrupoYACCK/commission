odoo.define('pos_commission.pos_commission', function (require) {
"use strict";

var gui = require('point_of_sale.gui');


var models = require('point_of_sale.models');
var screens = require('point_of_sale.screens');
var PosDB =require('point_of_sale.DB');
var core    = require('web.core');
var rpc = require('web.rpc');
var QWeb = core.qweb;

var _t      = core._t;

var PosModelSuper = models.PosModel;
var PosDBSuper = PosDB;
var OrderSuper = models.Order;
var ScreenWidgetSuper = screens.ScreenWidget
/*PosModelSuper.prototype.models.push(
);*/

models.Order = models.Order.extend({
    initialize: function(attributes,options){
        var res = OrderSuper.prototype.initialize.apply(this, arguments);
        this.agent_id1= false;
        this.agent_id2 = false;
        return res;
    },
    get_agent_id1: function () {
        return this.agent_id1;
    },
    get_agent_id2: function () {
        return this.agent_id2;
    },
    set_agent_id1: function (agent_id) {
        this.agent_id1 = agent_id;
    },
    set_agent_id2: function (agent_id) {
        this.agent_id2 = agent_id;
    },
    get_agent_ids: function () {
        var agent_ids = [];
        if (this.get_agent_id1() || this.get_agent_id2()) {
            var agent_id = []
            if (this.agent_id1) {
                agent_ids.push(this.get_agent_id1());
            }
            if (this.agent_id2) {
                agent_ids.push(this.get_agent_id2());
            }
        }
        return agent_ids;
    },
    export_as_JSON: function() {
        var res = OrderSuper.prototype.export_as_JSON.apply(this, arguments);        
        res['agent_ids'] = this.get_agent_ids();
        return res;
    },
});

});
