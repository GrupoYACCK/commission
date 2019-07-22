# Copyright 2014-2018 Tecnativa - Pedro M. Baeza
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo import api, fields, models


class PosOrder(models.Model):
    _inherit = "pos.order"

    @api.depends('lines.agents.amount')
    def _compute_commission_total(self):
        for record in self:
            record.commission_total = 0.0
            for line in record.lines:
                record.commission_total += sum(x.amount for x in line.agents)

    commission_total = fields.Float(
        string="Commissions",
        compute="_compute_commission_total",
        store=True,
    )

    def recompute_lines_agents(self):
        self.mapped('lines').recompute_agents()

    def _action_create_invoice_line(self, line=False, invoice_id=False):
        line_id = super(PosOrder, self)._action_create_invoice_line(line=line, invoice_id=invoice_id)
        if line_id:
            vals = line._prepare_invoice_line()
            line_id.write(vals)
        return line_id


class PosOrderLine(models.Model):
    _inherit = [
        "pos.order.line",
        "sale.commission.mixin",
    ]
    _name = "pos.order.line"

    agents = fields.One2many(
        string="Agents & commissions",
        comodel_name="pos.order.line.agent",
    )

    @api.model
    def create(self, vals):
        """Add agents for records created from automations instead of UI."""
        # We use this form as this is the way it's returned when no real vals
        agents_vals = vals.get('agents', [(6, 0, [])])
        if agents_vals and agents_vals[0][0] == 6 and not agents_vals[0][2]:
            order = self.env['pos.order'].browse(vals['order_id'])
            vals['agents'] = self._prepare_agents_vals_partner(
                order.partner_id,
            )
        return super().create(vals)

    def _prepare_agents_vals(self):
        self.ensure_one()
        res = super()._prepare_agents_vals()
        return res + self._prepare_agents_vals_partner(
            self.order_id.partner_id,
        )

    def _prepare_invoice_line(self, qty):
        #vals = super(PosOrderLine, self)._prepare_invoice_line(qty)
        vals = {}
        vals['agents'] = [
            (0, 0, {'agent': x.agent.id,
                    'commission': x.commission.id}) for x in self.agents]
        return vals


class PosOrderLineAgent(models.Model):
    _inherit = "sale.commission.line.mixin"
    _name = "pos.order.line.agent"

    object_id = fields.Many2one(
        comodel_name="pos.order.line",
    )
    currency_id = fields.Many2one(
        related="object_id.order_id.pricelist_id.currency_id",
        readonly=True,
    )

    @api.depends('object_id.price_subtotal')
    def _compute_amount(self):
        for line in self:
            order_line = line.object_id
            line.amount = line._get_commission_amount(
                line.commission, order_line.price_subtotal,
                order_line.product_id, order_line.product_uom_qty,
            )
