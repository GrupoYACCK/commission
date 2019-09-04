odoo.define('pos_commission.pos_commission', function (require) {
"use strict";

    var gui = require('point_of_sale.gui');

    var models   = require('point_of_sale.models');
    var screens  = require('point_of_sale.screens');
    var PosDB    = require('point_of_sale.DB');
    var core     = require('web.core');
    var rpc      = require('web.rpc');
    var QWeb     = core.qweb;

    var _t       = core._t;

    var PosModelSuper = models.PosModel;
    var OrderSuper = models.Order;
    var DomCache = screens.DomCache;

    /*--------------------------------------*\
     |         Pos DB                        |
    \*======================================*/
    PosDB.include({
        init: function(options){
            this._super.apply(this, arguments);

            this.agent_sorted = [];
            this.agent_by_id = {};
            this.agent_by_barcode = {};
            this.agent_search_string = "";
            this.agent_write_date = null;
        },

        _agent_search_string: function(agent){
            var str =  agent.name;
            if(agent.barcode){
                str += '|' + agent.barcode;
            }
            if(agent.address){
                str += '|' + agent.address;
            }
            if(agent.phone){
                str += '|' + agent.phone.split(' ').join('');
            }
            if(agent.mobile){
                str += '|' + agent.mobile.split(' ').join('');
            }
            if(agent.email){
                str += '|' + agent.email;
            }
            str = '' + agent.id + ':' + str.replace(':','') + '\n';
            return str;
        },

        add_agents: function(agents){
            var updated_count = 0;
            var agent;
            for(var i = 0, len = agents.length; i < len; i++){
                agent = agents[i];

                if (!this.agent_by_id[agent.id]) {
                    this.agent_sorted.push(agent.id);
                }
                this.agent_by_id[agent.id] = agent;

                updated_count += 1;
            }

            this.agent_write_date = agent.write_date || this.agent_write_date;

            if (updated_count) {
                // If there were updates, we need to completely
                // rebuild the search string and the barcode indexing

                this.agent_search_string = "";
                this.agent_by_barcode = {};

                for (var id in this.agent_by_id) {
                    agent = this.agent_by_id[id];

                    if(agent.barcode){
                        this.agent_by_barcode[agent.barcode] = agent;
                    }
                    agent.address = (agent.street || '') +', '+
                                      (agent.zip || '')    +' '+
                                      (agent.city || '')   +', '+
                                      (agent.country_id[1] || '');
                    this.agent_search_string += this._agent_search_string(agent);
                }
            }

            return updated_count;
        },

        get_agent_write_date: function(){
            return this.agent_write_date || "1970-01-01 00:00:00";
        },

        get_agent_by_id: function(id){
            return this.agent_by_id[id];
        },

        get_agent_by_barcode: function(barcode){
            return this.agent_by_barcode[barcode];
        },

        get_agents_sorted: function(max_count){
            max_count = max_count ? Math.min(this.agent_sorted.length, max_count) : this.agent_sorted.length;
            var agents = [];
            for (var i = 0; i < max_count; i++) {
                agents.push(this.agent_by_id[this.agent_sorted[i]]);
            }
            return agents;
        },

        search_agent: function(query){
            try {
                query = query.replace(/[\[\]\(\)\+\*\?\.\-\!\&\^\$\|\~\_\{\}\:\,\\\/]/g,'.');
                query = query.replace(/ /g,'.+');
                var re = RegExp("([0-9]+):.*?"+query,"gi");
            }catch(e){
                return [];
            }
            var results = [];
            for(var i = 0; i < this.limit; i++){
                var r = re.exec(this.agent_search_string);
                if(r){
                    var id = Number(r[1]);
                    results.push(this.get_agent_by_id(id));
                }else{
                    break;
                }
            }
            return results;
        },
    });

    /*--------------------------------------*\
     |         Pos Model                    |
    \*======================================*/
    models.PosModel = models.PosModel.extend({
        initialize: function(session, attributes) {
            var self = this;

            // Business data; loaded from the server at launch
            this.agents = [];

            self.models[5].fields.push('commission');
            self.models[5].fields.push('agent');
            self.models[5].fields.push('customer');
            self.models[5].domain = ['|',['agent','=',true],['customer','=',true]];
            self.models[5].loaded = function(self,partners){
                var partners_obj = [];
                var agents_obj = [];
                for (var i = 0; i < partners.length; i++) {
                    if(partners[i].agent){
                        agents_obj.push(partners[i]);
                    }
                    if(partners[i].customer){
                        partners_obj.push(partners[i]);
                    }
                }
                self.partners = partners_obj;
                self.db.add_partners(partners_obj);
                self.agents = agents_obj;
                self.db.add_agents(agents_obj);
            };

            self.models.push({
                model:  'sale.commission',
                fields: ['name'],
                loaded: function(self, commissions){
                    self.commissions = commissions;
                },
            });

            PosModelSuper.prototype.initialize.apply(this, arguments);

            this.set({
                'selectedAgent1':   null,
                'selectedAgent2':   null,
            });

            // Forward the 'agent' attribute on the selected order to 'selectedAgent1'
            function update_agents() {
                var order = self.get_order();
                this.set('selectedAgent1', order ? order.get_agent_1() : null );
                this.set('selectedAgent2', order ? order.get_agent_2() : null );
            }
            this.get('orders').bind('add remove change', update_agents, this);
            this.bind('change:selectedOrder', update_agents, this);
        },

        load_new_agents: function(){
            var self = this;
            var def  = new $.Deferred();
            var fields = _.find(this.models,function(model){ return model.model === 'res.partner'; }).fields;
            var domain = [['agent','=',true],['write_date','>',this.db.get_agent_write_date()]];
            rpc.query({
                    model: 'res.partner',
                    method: 'search_read',
                    args: [domain, fields],
                }, {
                    timeout: 3000,
                    shadow: true,
                })
                .then(function(agents){
                    if (self.db.add_agents(agents)) {   // check if the agents we got were real updates
                        def.resolve();
                    } else {
                        def.reject();
                    }
                }, function(type,err){ def.reject(); });
            return def;
        },

        get_agent_1: function() {
            var order = this.get_order();
            if (order) {
                return order.get_agent_1();
            }
            return null;
        },

        get_agent_2: function() {
            var order = this.get_order();
            if (order) {
                return order.get_agent_2();
            }
            return null;
        },

        push_and_invoice_order: function(order){
            var self = this;

            var invoiced = new $.Deferred();

            if(!order.get_agent_1() || !order.get_agent_2()){
                invoiced.reject({code:400, message:'Missing Agents', data:{}});
                return invoiced;
            }

            return PosModelSuper.prototype.push_and_invoice_order.apply(this, arguments);
        },
    });

    /*--------------------------------------*\
     |         PAYMENT SCREEN               |
    \*======================================*/
    // Haciendo que en la vista del pago funcionen los botones de seleccionar los Agentes
    screens.PaymentScreenWidget.include({
        init: function(parent, options) {
            var self = this;

            this._super(parent, options);

            this.pos.bind('change:selectedAgent1', function() {self.agents_changed();}, this);
            this.pos.bind('change:selectedAgent2', function() {self.agents_changed();}, this);
        },

        renderElement : function(){
            var self = this;
            this._super.apply(this, arguments);

            this.$('.js_set_agent1').click(function(){
                self.click_set_agent_1();
            });
            this.$('.js_set_agent2').click(function(){
                self.click_set_agent_2();
            });
        },

        click_set_agent_1: function() {
            // le paso parametros para saber cuando intento cargar el agente 1 o el 2
            this.gui.show_screen('agentlist', {selectedAgent1: true});
        },

        click_set_agent_2: function() {
            // le paso parametros para saber cuando intento cargar el agente 1 o el 2
            this.gui.show_screen('agentlist', {selectedAgent2: true});
        },

        agents_changed: function() {
            var agent_1 = this.pos.get_agent_1();
            var agent_2 = this.pos.get_agent_2();

            this.$('.js_agent_1_name').text( agent_1 ? agent_1.name : _t('Agent 1') );
            this.$('.js_agent_2_name').text( agent_2 ? agent_2.name : _t('Agent 2') );
        },
    })

    /*--------------------------------------*\
     |         THE AGENT LIST               |
    \*======================================*/

    // The agentlist displays the list of agents,
    // and allows the cashier to create, edit and assign agent.

    var AgentListScreenWidget = screens.ScreenWidget.extend({
        template: 'AgentListScreenWidget',

        init: function(parent, options){
            this._super(parent, options);
            this.agent_cache = new DomCache();
        },

        auto_back: true,

        show: function(){
            var self = this;
            this._super();

            this.renderElement();
            this.details_visible = false;

            // capturando los parametros que pase en el 'PaymentScreenWidget' para saber que 'agente'
            // es el que quiero capturar
            this.selectedAgent1 = this.gui.get_current_screen_param('selectedAgent1');
            this.selectedAgent2 = this.gui.get_current_screen_param('selectedAgent2');

            if(this.selectedAgent1)
                this.old_agent = this.pos.get_order().get_agent_1();
            else if(this.selectedAgent2)
                this.old_agent = this.pos.get_order().get_agent_2();

            this.$('.back').click(function(){
                self.gui.back();
            });

            this.$('.next').click(function(){
                self.save_changes();
                self.gui.back();    // FIXME HUH ?
            });

            this.$('.new-customer').click(function(){
                self.display_agent_details('edit', {
                    'country_id': self.pos.company.country_id,
                });
            });

            var agents = this.pos.db.get_agents_sorted(1000);
            this.render_list(agents);

            this.reload_agents();

            if( this.old_agent ){
                this.display_agent_details('show',this.old_agent,0);
            }

            this.$('.client-list-contents').delegate('.client-line','click',function(event){
                self.line_select(event,$(this),parseInt($(this).data('id')));
            });

            var search_timeout = null;

            if(this.pos.config.iface_vkeyboard && this.chrome.widget.keyboard){
                this.chrome.widget.keyboard.connect(this.$('.searchbox input'));
            }

            this.$('.searchbox input').on('keypress',function(event){
                clearTimeout(search_timeout);

                var searchbox = this;

                search_timeout = setTimeout(function(){
                    self.perform_search(searchbox.value, event.which === 13);
                },70);
            });

            this.$('.searchbox .search-clear').click(function(){
                self.clear_search();
            });
        },

        hide: function () {
            this._super();
            this.new_agent = null;
        },

        barcode_agent_action: function(code){
            if (this.editing_agent) {
                this.$('.detail.barcode').val(code.code);
            } else if (this.pos.db.get_agent_by_barcode(code.code)) {
                var agent = this.pos.db.get_agent_by_barcode(code.code);
                this.new_agent = agent;
                this.display_agent_details('show', agent);
            }
        },

        perform_search: function(query, associate_result){
            var agents;
            if(query){
                agents = this.pos.db.search_agent(query);
                this.display_agent_details('hide');
                if ( associate_result && agents.length === 1){
                    this.new_agent = agents[0];
                    this.save_changes();
                    this.gui.back();
                }
                this.render_list(agents);
            }else{
                agents = this.pos.db.get_agents_sorted();
                this.render_list(agents);
            }
        },

        clear_search: function(){
            var agents = this.pos.db.get_agents_sorted(1000);
            this.render_list(agents);
            this.$('.searchbox input')[0].value = '';
            this.$('.searchbox input').focus();
        },

        render_list: function(agents){
            var contents = this.$el[0].querySelector('.client-list-contents');
            contents.innerHTML = "";
            for(var i = 0, len = Math.min(agents.length,1000); i < len; i++){
                var agent    = agents[i];
                var agentline = this.agent_cache.get_node(agent.id);
                if(!agentline){
                    var agentline_html = QWeb.render('AgentLine',{widget: this, agent:agent});
                    var agentline = document.createElement('tbody');
                    agentline.innerHTML = agentline_html;
                    agentline = agentline.childNodes[1];
                    this.agent_cache.cache_node(agent.id,agentline);
                }
                if( agent === this.old_agent ){
                    agentline.classList.add('highlight');
                }else{
                    agentline.classList.remove('highlight');
                }
                contents.appendChild(agentline);
            }
        },

        save_changes: function(){
            var order = this.pos.get_order();

            if( this.has_agent_changed() ){
                var default_fiscal_position_id = _.findWhere(this.pos.fiscal_positions, {'id': this.pos.config.default_fiscal_position_id[0]});
                if ( this.new_agent ) {
                    if (this.new_agent.property_account_position_id ){
                      var agent_fiscal_position_id = _.findWhere(this.pos.fiscal_positions, {'id': this.new_agent.property_account_position_id[0]});
                      order.fiscal_position = agent_fiscal_position_id || default_fiscal_position_id;
                    }
                    order.set_pricelist(_.findWhere(this.pos.pricelists, {'id': this.new_agent.property_product_pricelist[0]}) || this.pos.default_pricelist);
                } else {
                    order.fiscal_position = default_fiscal_position_id;
                    order.set_pricelist(this.pos.default_pricelist);
                }

                // estas variables 'selectedAgent1' y 'selectedAgent2' obtienen valor en el metodo 'show'
                if(this.selectedAgent1) {
                    order.set_agent_1(this.new_agent);
                }
                else if(this.selectedAgent2) {
                    order.set_agent_2(this.new_agent);
                }
            }
        },

        has_agent_changed: function(){
            if( this.old_agent && this.new_agent ){
                return this.old_agent.id !== this.new_agent.id;
            }else{
                return !!this.old_agent !== !!this.new_agent;
            }
        },

        toggle_save_button: function(){
            var $button = this.$('.button.next');
            if (this.editing_agent) {
                $button.addClass('oe_hidden');
                return;
            } else if( this.new_agent ){
                if(!this.old_agent){
                    $button.text(_t('Set Agent'));
                }else{
                    $button.text(_t('Change Agent'));
                }
            }else{
                $button.text(_t('Deselect Agent'));
            }
            $button.toggleClass('oe_hidden',!this.has_agent_changed());
        },

        line_select: function(event,$line,id){
            var agent = this.pos.db.get_agent_by_id(id);
            this.$('.client-list .lowlight').removeClass('lowlight');
            if ( $line.hasClass('highlight') ){
                $line.removeClass('highlight');
                $line.addClass('lowlight');
                this.display_agent_details('hide',agent);
                this.new_agent = null;
                this.toggle_save_button();
            }else{
                this.$('.client-list .highlight').removeClass('highlight');
                $line.addClass('highlight');
                var y = event.pageY - $line.parent().offset().top;
                this.display_agent_details('show',agent,y);
                this.new_agent = agent;
                this.toggle_save_button();
            }
        },

        agent_icon_url: function(id){
            return '/web/image?model=res.partner&id='+id+'&field=image_small';
        },

        // ui handle for the 'edit selected agent' action
        edit_agent_details: function(agent) {
            this.display_agent_details('edit',agent);
        },

        // ui handle for the 'cancel agent edit changes' action
        undo_agent_details: function(agent) {
            if (!agent.id) {
                this.display_agent_details('hide');
            } else {
                this.display_agent_details('show',agent);
            }
        },

        // what happens when we save the changes on the agent edit form -> we fetch the fields, sanitize them,
        // send them to the backend for update, and call saved_agent_details() when the server tells us the
        // save was successfull.
        save_agent_details: function(agent) {
            var self = this;

            var fields = {};
            this.$('.client-details-contents .detail').each(function(idx,el){
                fields[el.name] = el.value || false;
            });

            if (!fields.name) {
                this.gui.show_popup('error',_t('A Agent Name Is Required'));
                return;
            }

            if (this.uploaded_picture) {
                fields.image = this.uploaded_picture;
            }

            fields.id           = agent.id || false;
            fields.country_id   = fields.country_id || false;
            fields.agent        = true;
            fields.customer     = false;
            fields.supplier     = false;            

            if (fields.property_product_pricelist) {
                fields.property_product_pricelist = parseInt(fields.property_product_pricelist, 10);
            } else {
                fields.property_product_pricelist = false;
            }
            var contents = this.$(".client-details-contents");
            contents.off("click", ".button.save");

            rpc.query({
                    model: 'res.partner',
                    method: 'create_from_ui',
                    args: [fields],
                })
                .then(function(agent_id){
                    self.saved_agent_details(agent_id);
                },function(err,ev){
                    ev.preventDefault();
                    var error_body = _t('Your Internet connection is probably down.');
                    if (err.data) {
                        var except = err.data;
                        error_body = except.arguments && except.arguments[0] || except.message || error_body;
                    }
                    self.gui.show_popup('error',{
                        'title': _t('Error: Could not Save Changes'),
                        'body': error_body,
                    });
                    contents.on('click','.button.save',function(){ self.save_agent_details(agent); });
                });
        },

        // what happens when we've just pushed modifications for a agent of id agent_id
        saved_agent_details: function(agent_id){
            var self = this;
            this.reload_agents().then(function(){
                var agent = self.pos.db.get_agent_by_id(agent_id);
                if (agent) {
                    self.new_agent = agent;
                    self.toggle_save_button();
                    self.display_agent_details('show',agent);
                } else {
                    // should never happen, because create_from_ui must return the id of the agent it
                    // has created, and reload_agent() must have loaded the newly created agent.
                    self.display_agent_details('hide');
                }
            }).always(function(){
                $(".client-details-contents").on('click','.button.save',function(){ self.save_agent_details(agent); });
            });
        },

        // resizes an image, keeping the aspect ratio intact,
        // the resize is useful to avoid sending 12Mpixels jpegs
        // over a wireless connection.
        resize_image_to_dataurl: function(img, maxwidth, maxheight, callback){
            img.onload = function(){
                var canvas = document.createElement('canvas');
                var ctx    = canvas.getContext('2d');
                var ratio  = 1;

                if (img.width > maxwidth) {
                    ratio = maxwidth / img.width;
                }
                if (img.height * ratio > maxheight) {
                    ratio = maxheight / img.height;
                }
                var width  = Math.floor(img.width * ratio);
                var height = Math.floor(img.height * ratio);

                canvas.width  = width;
                canvas.height = height;
                ctx.drawImage(img,0,0,width,height);

                var dataurl = canvas.toDataURL();
                callback(dataurl);
            };
        },

        // Loads and resizes a File that contains an image.
        // callback gets a dataurl in case of success.
        load_image_file: function(file, callback){
            var self = this;
            if (!file.type.match(/image.*/)) {
                this.gui.show_popup('error',{
                    title: _t('Unsupported File Format'),
                    body:  _t('Only web-compatible Image formats such as .png or .jpeg are supported'),
                });
                return;
            }

            var reader = new FileReader();
            reader.onload = function(event){
                var dataurl = event.target.result;
                var img     = new Image();
                img.src = dataurl;
                self.resize_image_to_dataurl(img,800,600,callback);
            };
            reader.onerror = function(){
                self.gui.show_popup('error',{
                    title :_t('Could Not Read Image'),
                    body  :_t('The provided file could not be read due to an unknown error'),
                });
            };
            reader.readAsDataURL(file);
        },

        // This fetches agent changes on the server, and in case of changes,
        // rerenders the affected views
        reload_agents: function(){
            var self = this;
            return this.pos.load_new_agents().then(function(){
                // agents may have changed in the backend
                self.agent_cache = new DomCache();

                self.render_list(self.pos.db.get_agents_sorted(1000));

                // update the currently assigned agent if it has been changed in db.
                var curr_agent_1 = self.pos.get_order().get_agent_1();
                if (curr_agent_1) {
                    self.pos.get_order().set_agent_1(self.pos.db.get_agent_by_id(curr_agent_1.id));
                }

                var curr_agent_2 = self.pos.get_order().get_agent_2();
                if (curr_agent_2) {
                    self.pos.get_order().set_agent_2(self.pos.db.get_agent_by_id(curr_agent_2.id));
                }
            });
        },

        // Shows,hides or edit the agent details box :
        // visibility: 'show', 'hide' or 'edit'
        // agent:    the agent object to show or edit
        // clickpos:   the height of the click on the list (in pixel), used
        //             to maintain consistent scroll.
        display_agent_details: function(visibility,agent,clickpos){
            var self = this;
            var searchbox = this.$('.searchbox input');
            var contents = this.$('.client-details-contents');
            var parent   = this.$('.client-list').parent();
            var scroll   = parent.scrollTop();
            var height   = contents.height();

            contents.off('click','.button.edit');
            contents.off('click','.button.save');
            contents.off('click','.button.undo');
            contents.on('click','.button.edit',function(){ self.edit_agent_details(agent); });
            contents.on('click','.button.save',function(){ self.save_agent_details(agent); });
            contents.on('click','.button.undo',function(){ self.undo_agent_details(agent); });
            this.editing_agent = false;
            this.uploaded_picture = null;

            if(visibility === 'show'){
                contents.empty();
                contents.append($(QWeb.render('AgentDetails',{widget:this,agent:agent})));

                var new_height   = contents.height();

                if(!this.details_visible){
                    // resize agent list to take into account agent details
                    parent.height('-=' + new_height);

                    if(clickpos < scroll + new_height + 20 ){
                        parent.scrollTop( clickpos - 20 );
                    }else{
                        parent.scrollTop(parent.scrollTop() + new_height);
                    }
                }else{
                    parent.scrollTop(parent.scrollTop() - height + new_height);
                }

                this.details_visible = true;
                this.toggle_save_button();
            } else if (visibility === 'edit') {
                // Connect the keyboard to the edited field
                if (this.pos.config.iface_vkeyboard && this.chrome.widget.keyboard) {
                    contents.off('click', '.detail');
                    searchbox.off('click');
                    contents.on('click', '.detail', function(ev){
                        self.chrome.widget.keyboard.connect(ev.target);
                        self.chrome.widget.keyboard.show();
                    });
                    searchbox.on('click', function() {
                        self.chrome.widget.keyboard.connect($(this));
                    });
                }

                this.editing_agent = true;
                contents.empty();
                contents.append($(QWeb.render('AgentDetailsEdit',{widget:this,agent:agent})));
                this.toggle_save_button();

                // Browsers attempt to scroll invisible input elements
                // into view (eg. when hidden behind keyboard). They don't
                // seem to take into account that some elements are not
                // scrollable.
                contents.find('input').blur(function() {
                    setTimeout(function() {
                        self.$('.window').scrollTop(0);
                    }, 0);
                });

                contents.find('.image-uploader').on('change',function(event){
                    self.load_image_file(event.target.files[0],function(res){
                        if (res) {
                            contents.find('.client-picture img, .client-picture .fa').remove();
                            contents.find('.client-picture').append("<img src='"+res+"'>");
                            contents.find('.detail.picture').remove();
                            self.uploaded_picture = res;
                        }
                    });
                });
            } else if (visibility === 'hide') {
                contents.empty();
                parent.height('100%');
                if( height > scroll ){
                    contents.css({height:height+'px'});
                    contents.animate({height:0},400,function(){
                        contents.css({height:''});
                    });
                }else{
                    parent.scrollTop( parent.scrollTop() - height);
                }
                this.details_visible = false;
                this.toggle_save_button();
            }
        },

        close: function(){
            this._super();
            if (this.pos.config.iface_vkeyboard && this.chrome.widget.keyboard) {
                this.chrome.widget.keyboard.hide();
            }
        },
    });
    gui.define_screen({name:'agentlist', widget: AgentListScreenWidget});

    /*--------------------------------------*\
     |         Sale Order                   |
    \*======================================*/
    models.Order = models.Order.extend({
        initialize: function(attributes,options){
            var res = OrderSuper.prototype.initialize.apply(this, arguments);
            return res;
        },

        get_agent_1: function () {
            return this.get('agent_1');
        },

        get_agent_2: function () {
            return this.get('agent_2');
        },

        set_agent_1: function (agent) {
            this.assert_editable();
            this.set('agent_1',agent);
        },

        set_agent_2: function (agent) {
            this.assert_editable();
            this.set('agent_2',agent);
        },

        get_agent_ids: function(){
            var agent_ids = [];
            if (this.get_agent_1() || this.get_agent_2()) {
                if (this.get_agent_1()){
                    agent_ids.push(this.get_agent_1().id);
                }
                if (this.get_agent_2()){
                    agent_ids.push(this.get_agent_2().id);
                }
                   
            }
            return agent_ids;
        },

        export_as_JSON: function() {
            var res = OrderSuper.prototype.export_as_JSON.apply(this, arguments);
            //res['agent_1'] = this.get_agent_1() ? this.get_agent_1().id : false;
            //res['agent_2'] = this.get_agent_2() ? this.get_agent_2().id : false;
            res['agent_ids'] = this.get_agent_ids();
            return res;
        },

        init_from_JSON: function(json) {
            if (json.agent_1) {
                var agent = this.pos.db.get_agent_by_id(json.agent_1);
                this.set_agent_1(agent);
            } else {
                this.set_agent_1(null);
            }

            if (json.agent_2) {
                var agent = this.pos.db.get_agent_by_id(json.agent_2);
                this.set_agent_2(agent);
            } else {
                this.set_agent_2(null);
            }

            OrderSuper.prototype.init_from_JSON.apply(this, arguments);
        },
    });
});
