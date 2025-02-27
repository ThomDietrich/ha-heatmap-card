/*
    Note that this file includes a third party library for ease of distribution.
    This license applies only to the Heatmap card code; anything after the "8< 8< 8< 8< 8<"
    mark in this file is covered under a separate license, further down.
    ---

    HeatMap card for Home Assistant

    Copyright 2023 Kriss Andsten

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

/*
    * General code layout *

    There are three routines whose quirks drive the overall design and quirks:
      - render(): Displays the actual card contents. Called infrequently. All
                  HTML templating is captured in this and related routines. We
                  also do some config checking here and render errors if we
                  detect that we're inside of the card editor; this is fugly, but
                  as we don't have access to the hass object in setConfig(), this
                  seemed like a necessary evil.

      - set hass(): Called by HA's UI rather frequently, so we make sure to
                    cache aggressively. On load (rendering our tag) + after
                    config changes, we're:
                      - Calling populate_meta()
                        to setup some values based on the HA configuration + our
                        card configuration, with defaults as applicable.
                      - Fetch the data to drive the heatmap from the recorder.

      - setConfig(): Called by HA's UI when the card is first displayed
                     and again when the config changes. Note that it's called
                     *before* set hass(), meaning we can't use the hass object
                     to validate our config, annoyingly enough.
*/

/*
    Use lit from Home Assistant rather than by sourcing it externally.
    This is not recommended practice (per HA blog entry, below), but it
    does seem to make some sense. Will deal with external sourcing
    if we run into trouble later on.

    Reference: https://developers.home-assistant.io/blog/2021/05/19/lit-2.0/
*/ 
const LitElement = Object.getPrototypeOf(customElements.get("ha-panel-lovelace"));
const html = LitElement.prototype.html;
const css = LitElement.prototype.css;


class HeatmapCard extends LitElement {
    hass_inited = false;
    static get properties() {
        return {
            hass: {},
            config: {},
            grid: [],
            meta: {},
            tooltipOpen: false,
            selected_val: ''
        };
    }

    render() {
        // We may be trying to render before we've received the recorder data.
        if (this.grid === undefined) { this.grid = []; }
        // We're in the editor interface. Check for config errors that we can't check for in setConfig since
        // don't have the hass object reliably available in that function.
        if (this.parentNode.nodeName === 'HUI-CARD-PREVIEW') {
            if (this.meta.state_class === 'total_increasing' && this.config.data.max === undefined) {
                return html`<span class="error"><p>Error: Your entity is displaying consumption data (kWh of energy, m³ of gas, similar)
                but your card configuration is lacking a value for <code>data.max</code>. This will cause the heatmap colors to re-scale
                based on the currently shown values in the table rather than maintain consistency over time.</p>
                <p>Either set <code>data.max</code> to the expected maximum value or to <code>auto</code>
                to accept this re-scaling.</p>
                </span>`
            }
            else if (this.meta.state_class === undefined) {
                return html`<span class="error"<p>Error: This entity is not a sensor. Only sensors are supported currently.</p></span>`
            }
        }
        return html`
            <ha-card header="${this.meta.title}" id="card">
                <div class="card-content">
                    <table>
                        <tr class="first">
                            <th class="hm-row-title">${this.myhass.localize('ui.dialogs.helper_settings.input_datetime.date')}</th>
                            ${this.date_table_headers()}
                        </tr>
                    ${this.grid.map((entry) => 
                        html`<tr>
                            <td class="hm-row-title">${entry.date}</td>
                            ${entry.vals.map((util) => {
                                var css_class="hm-box";
                                var r = util;
                                if (r === null) { css_class += " null"; }
                                if (this.meta.scale.type === 'relative') {
                                    const diff = this.meta.data.max - this.meta.data.min
                                    r = (util - this.meta.data.min) / diff;
                                    if (r < 0) { r = 0 };
                                    if (r > 1) { r = 1 };
                                }
                                const col = this.meta.scale.gradient(r);
                                return html`<td @click="${this.toggle_tooltip}" class="${css_class}" data-val="${util}" style="color: ${col}"></td>`
                            })}
                        </tr>`
                    )}
                    </table>
                    ${this.render_legend()}
                    <div id="tooltip" class="${this.tooltipOpen ? 'active' : 'hidden'}">${parseFloat(this.selected_val).toFixed(2)} ${this.meta.unit_of_measurement}</div>
                </div>
            </ha-card>
        `;
    }

    /* Deal with 24h vs 12h time */
    date_table_headers() {
        if (this.myhass.locale.time_format === '12') {
            return html`
                <th>12 PM</th><th>1 AM</th><th>2 AM</th><th>3 AM</th><th>4 AM</th><th>5 AM</th><th>6 AM</th><th>7 AM</th>
                <th>8 AM</th><th>9 AM</th><th>10 AM</th><th>11 AM</th><th>12 AM</th><th>1 PM</th><th>2 PM</th><th>3 PM</th>
                <th>4 PM</th><th>5 PM</th><th>6 PM</th><th>7 PM</th><th>8 PM</th><th>9 PM</th><th>10 PM</th><th>11 PM</th>
            `            
        } else {
            return html`
                <th>00</th><th>01</th><th>02</th><th>03</th><th>04</th><th>05</th><th>06</th><th>07</th>
                <th>08</th><th>09</th><th>10</th><th>11</th><th>12</th><th>13</th><th>14</th><th>15</th>
                <th>16</th><th>17</th><th>18</th><th>19</th><th>20</th><th>21</th><th>22</th><th>23</th>
            `
        }
    }

    render_legend() {
        if (this.config.display.legend === false) {
            return;
        }
        const ticks = this.legend_scale(this.meta.scale);
        return html`
            <div class="legend-container">
                <div id="legend" style="background: linear-gradient(90deg, ${this.meta.scale.css})"></div>
                <div class="tick-container">
                    ${ticks.map((tick) => html`
                        <div class="legend-tick" style="left: ${tick[0]}%;"">
                            <div class="caption">${tick[1]} ${this.meta.unit_of_measurement}</div>
                        </div>
                        <span class="legend-shadow">${tick[1]} ${this.meta.unit_of_measurement}</span>`
                    )}
                </div>
            </div>
        `
    }

    legend_scale(scale) {
        /*
            Figure out how to space the markings in the legend. There's some room for improvement
            in that we could snap this to more human friendly values such as integers, .5 and
            similar.
        */
        var ticks = [];
        if (scale.type === 'relative') {
            // Figure out our own steps, this scale ranges from 0-1.
            var diff = this.meta.data.max - this.meta.data.min;
            for (var i = 0; i <= 5; i++) {
                ticks.push(
                    [
                        i * 20,
                        +(Number(this.meta.data.min + (diff / 5) * i).toFixed(2))
                    ]
                )}
        } else {
            // This scale has steps defined in the scale. Use them.
            var min = scale.steps[0].value;
            var max = scale.steps[scale.steps.length - 1].value;
            var span = max - min;
            for (const entry of scale.steps) {
                ticks.push([
                    ((entry.value - min) / span) * 100,
                    entry.value
                ])
            }
        }
        return ticks;
    }

    /* Todo: research precision in data, how to use (abs. temp) */
    toggle_tooltip(e) {
        const oldSelection = this.renderRoot.querySelector("#selected");
        const card = this.renderRoot.querySelector("#card");
        const tooltip = this.renderRoot.querySelector("#tooltip");
        const target = e.target;
        if (oldSelection) {
            oldSelection.removeAttribute('id');
            if (oldSelection === e.target) {
                this.tooltipOpen = false;
                return;
            }
        }
        this.tooltipOpen = true;
        target.id = 'selected';
        /*
            Todo: Improved handling when we're close to the page edges.
        */
        var rect = target.getBoundingClientRect();
        var cardRect = card.getBoundingClientRect();
        var top = rect.top - cardRect.top;
        var left = rect.left - cardRect.left;
        tooltip.style.top = (top - 30 - rect.height).toString() + "px";
        tooltip.style.left = (left - (rect.width / 2) - 70) .toString() + "px";
        this.selected_val = target.dataset.val;
    }

    /*
        Whenever the state changes, a new `hass` object is set. We fetch some metadata
        the first time over but generally don't want to update frequently.
    */
    set hass(hass) {
        // Initialize the content if it's not there yet.
        if (this.hass_inited === true) { return }
        this.myhass = hass;
        this.meta = this.populate_meta(hass);
        var consumers = [this.config.entity];
        this.get_recorder(consumers, this.config.days);
        this.hass_inited = true;
    }

    /*
        Todo: Test this with other units, make sure it works also for imperial, honors
        user preference.
    */
    get_recorder(consumers, days) {
        const now = new Date();
        var startTime = new Date(now - (days * 86400000))
        startTime.setHours(23, 0, 0);
        this.myhass.callWS({
            'type': 'recorder/statistics_during_period',
            'statistic_ids': consumers,
            "period":"hour",
            "units": {
                "energy":"kWh",
                "temperature": this.myhass.config.unit_system.temperature
            },
            "start_time": startTime.toISOString(),
            "types":["sum", "mean"]
        }).then(recorderResponse => {
            /* Todo: Intermediate grouping step for supporting multiple entities */
            for (const consumer of consumers) {
                const consumerData = recorderResponse[consumer];
                switch (this.meta.state_class) {
                    case 'measurement':
                        this.grid = this.calculate_measurement_values(consumerData);
                        break;
                    case 'total_increasing':
                        this.grid = this.calculate_increasing_values(consumerData);
                        break;
                    default:
                        throw new Error(`Unknown state_class defined (${this.meta['state_class']} for ${consumer}.`);
                }
            }
            if (this.config.data.max === 'auto') {
                this.meta.data.max = this.max_from(this.grid)
            }
            if (this.config.data.min === 'auto') {
                this.meta.data.min = this.min_from(this.grid)
            }
        });
    }

    // Todo: Refactor at some point, lots of copying for no good reason
    max_from(grid) {
        var vals = [];
        for (const entry of grid) {
            vals = vals.concat(entry.vals);
        }
        return Math.max(...vals);
    }

    // Todo: Refactor at some point, lots of copying for no good reason
    min_from(grid) {
        var vals = [];
        for (const entry of grid) {
            vals = vals.concat(entry.vals);
        }
        return Math.min(...vals);
    }

    calculate_measurement_values(consumerData) {
        var grid = [];
        var gridTemp = [];
        for (const entry of consumerData) {
            const start = new Date(entry.start);
            const hour = start.getHours();
            if (hour === 0) {
                const dateRep = start.toLocaleDateString(this.meta.language, {month: 'short', day: '2-digit'});
                gridTemp = [];
                grid.push({'date': dateRep, 'nativeDate': start, 'vals': gridTemp});
            }
            gridTemp[hour] = entry.mean;
        }
        return grid.reverse();
    }

    // Todo: cleanup and comment.
    calculate_increasing_values(consumerData) {
        var grid = [];
        var prev = null;
        var gridTemp = [];
        var prevDate = null; 
        var hour;
        for (const entry of consumerData) {
            const start = new Date(entry.start);
            hour = start.getHours();
            const dateRep = start.toLocaleDateString(this.meta.language, {month: 'short', day: '2-digit'});

            if (dateRep !== prevDate && prev !== null) {
                gridTemp = Array(24).fill(0);
                grid.push({'date': dateRep, 'nativeDate': start, 'vals': gridTemp});
            }
            if (prev !== null) {
                var util = (entry.sum - prev).toFixed(2);
                gridTemp[hour] = util
            }
            prev = entry.sum;
            prevDate = dateRep;
        }
        /*
            For the last date in the series, remove any entries that we didn't get from
            Home Assistant. This would typically be hours set in the future.
        */
        gridTemp.splice(hour + 1);
        return grid.reverse();
    }

    populate_meta(hass) {
        const consumerAttributes = hass.states[this.config.entity].attributes;
        var meta = {
            'unit_of_measurement': consumerAttributes.unit_of_measurement,
            'state_class': consumerAttributes.state_class,
            'device_class': consumerAttributes.device_class,
            'language': hass.selectedLanguage ?? hass.language ?? 'en',
            'scale': this.generate_scale(
                this.config.scale ?? 
                this.device_class_defaults[consumerAttributes.device_class] ??
                'iron red'
            ),
            'title': (this.config.title ?? (this.config.title === null ? undefined : consumerAttributes.friendly_name)),
            'data': {
                'max': this.config.data.max,
                'min': (this.config.data.min ?? 0)
            },
        };
        return meta;
    }

    /* Todo: Error checking for if the domain.length != colors.length */
    /* Todo: possibly also consider supporting other options for chromajs */
    generate_scale(config) {
        // Are we refering to one of the builtin types by name? Resolve it.
        if (typeof(config) === 'string') {
            if (this.builtin_scales[config] === undefined) {
                return null
            } else {
                config = this.builtin_scales[config];
            }
        };
        var colors = [];
        var domains = [];

        for (const step of config.steps) {
            /*
                This is a bit fugly in that we're just converting the units rather than using
                a whole separate scale for Fahrenheit. However, it seems that the conversion is
                Close Enough for all practical purposes; US standards still adhere to the same
                physical properties as the rest of the world re comfort temperatures, etc. Will
                revisit this if need be, but keeping it simple for now.
            */
            if (this.myhass.config.unit_system.temperature === '°F' && config.unit === '°C') {
                step.value = Math.round((step.value * 1.8) + 32);
            }
            colors.push(step.color);
            if ('value' in step) {
                domains.push(step.value)
            }
        }
        var gradient;
        if (domains.length > 0 && domains.length == colors.length) {
            gradient = chroma.scale(colors).domain(domains);
        } else {
            gradient = chroma.scale(colors);
        }
        return {
            'gradient': gradient,
            'type': config.type ?? 'relative',
            'name': config.name,
            'steps': config.steps,
            'css': this.legend_css_by_gradient(gradient)
        }
    }

    legend_css_by_gradient(gradient) {
        var fragment = [];
        for (const [idx, color] of gradient.colors(21).entries()) {
            fragment.push(`${color} ${idx * 5}%`);
        }
        return fragment.join(', ');
    }

    /*
        The user supplied configuration. Throw an exception and Home Assistant
        will render an error card. No access to the hass object at this point
        sadly; it'd simplify things a bit. Some of the config error checking
        code can be found in render() instead.
    */
    setConfig(config) {
        if (!config.entity) {
            throw new Error("You need to define an entity");
        }
        if (config.days && config.days <= 0) {
            throw new Error("`days` need to be 1 or higher");
        }
        this.config = {
            'title': config.title,
            'days': (config.days ?? 21),
            'entity': config.entity,
            'scale': config.scale,
            'data': (config.data ?? {}),
            'display': (config.display ?? {})
        };
        if (this.config.data.max !== undefined && 
            (this.config.data.max !== 'auto' && 
            typeof(this.config.data.max) !== 'number')
        ) {
            throw new Error("`data.max` need to be either `auto` or a number");
        }
        if (this.config.data.min !== undefined && 
            (this.config.data.min !== 'auto' && 
            typeof(this.config.data.min) !== 'number')
        ) {
            throw new Error("`data.min` need to be either `auto` or a number");
        }
        this.hass_inited = false;
    }
  
    // The height of your card. Home Assistant uses this to automatically
    // distribute all cards over the available columns.
    getCardSize() {
        if (!this.config.days) {
            return 1;
        } else {
            return (1 + Math.ceil(this.config.days / 6));
        }
    }

    static styles = css`
            /* Heatmap table */
            table {
                border: none;
                border-spacing: 0px;
                table-layout:fixed;
                width: 100%;
                pointer-events: none;
                user-drag: none;
                user-select: none;
            }
            th {
                opacity: 0.7;
                font-weight: normal;
                vertical-align: bottom;
            }
            th:not(.hm-row-title) {
                font-size: 80%;
                transform: rotate(-90deg);
                padding-left: 3px;
                text-align: center;
                white-space: nowrap;
            }
            tr {
                line-height: 1.1;
                overflow: hidden;
                font-size: 90%;
            }
            .hm-row-title {
                text-align: left;
                max-height: 20px;
                min-width: 50px;
                width: 50px;
                opacity: 0.7;
            }
            .hm-box {
                background-color: currentcolor;
                pointer-events: auto;
            }
            #selected {
                outline: 6px currentcolor solid;
                z-index: 2;
                margin: 3px;
                position: relative;
                box-shadow: 0px 0px 0px 7px rgba(0,0,0,1), 0px 0px 0px 8px rgba(255,255,255,1);
            }

            /* Legend */
            .legend-container {
                margin-top: 20px;
                width: 80%;
                margin-left: auto;
                margin-right: 5%;
                position: relative;

            }
            .tick-container {
                position: relative:
                left: -10px;
            }
            #legend {
                height: 10px;
                outline-style: solid;
                outline-width: 1px;
                /*
                    Background is set via the style attribute in the object while rendering,
                    as lit-element and CSS templating is a bit of a PITA.
                */
            }

            .legend-tick {
                position: absolute;
                top: 10px;
                height: 10px;
                vertical-align: bottom;
                border-left-style: solid;
                border-left-width: 1px;
                white-space: nowrap;
                text-align: right;
                opacity: 0.7;
            }

            .legend-container .caption {
                position: relative;
                top: -15px;
                transform: translateY(100%) rotate(90deg);
                transform-origin: center left;
                font-size: 80%;
                text-align: left;
            }

            /*
                We use a non-visible shadow copy of the tick captions
                to get a height for the element. As the ticks themselves
                are position: absolute'd, we can't use their height for
                this purpose without some JS kludging.
            */
            span.legend-shadow {
                margin-top: 15px;
                position: relative;
                border-color: red;
                border-style: solid;
                writing-mode: vertical-rl;
                transform-origin: bottom left;
                font-size: 80%;
                line-height: 0.2;
                visibility: hidden;
            }


            /* Detail view */
            #tooltip {
                display: none;
                z-index: 1;
                position: absolute;
                padding: 6px;
                border-radius: 4px;
                background: var(--ha-card-background, var(--card-background-color, white) );
                border-color: currentcolor;
                border-width: 1px;
                border-style: solid;
                white-space: nowrap;
            }
            #tooltip.active {
                display: block;
            }

            /* Errors - only visible in edit mode */
            .error {
                color: red;
            }
        `;

    builtin_scales = {
        'black hot': {
            'name': 'Black hot',
            'type': 'relative',
            'steps': [
                {
                    'value': 0,
                    'color': '#F5F5F5'
                },
                {
                    'value': 1,
                    'color': '#242124'
                }
            ]
        },
        'carbon dioxide': {
            'name': 'CO₂',
            'type': 'absolute',
            'steps': [
                {
                    'value': 520,
                    'color': '#6d9b17'
                },
                {
                    'value': 1000,
                    'color': '#FFBF00'
                },
                {
                    'value': 1400,
                    'color': '#cf0000'
                },
                {
                    'value': 3000,
                    'color': '#5b0f8c'
                }
            ]
        },
        'indoor temperature': {
            'name': 'Indoor temperature',
            'type': 'absolute',
            'unit': '°C',
            'steps': [
                {
                    'value': 12,
                    'legend': 'Freezing',
                    'color': '#0f3489'
                },
                {
                    'value': 16,
                    'legend': 'Very low',
                    'color': '#595ea3'
                },
                {
                    'value': 18,
                    'color': '#7374b0'
                },
                {
                    'value': 20,
                    'color': '#F5F5F5'
                },
                {
                    'value': 22,
                    'color': '#F5F5F5'
                },
                {
                    'value': 24,
                    'color': '#ea755a',
                    'legend': 'High'
                },
                {
                    'value': 28,
                    'color': '#cf0000',
                    'legend': 'Very high'
                }
            ]
        },
        'iron red': {
            'name': 'Iron red',
            'type': 'relative',
            'steps': [
                {
                    'value': 0,
                    'color': '#230382'
                },
                {
                    'value': 0.1,
                    'color': '#921C96'
                },
                {
                    'value': 0.25,
                    'color': '#C93F55'
                },
                {
                    'value': 0.4,
                    'color': '#DF6D2D'
                },
                {
                    'value': 0.6,
                    'color': '#EFB03D'
                },
                {
                    'value': 0.75,
                    'color': '#F9DE52'
                },
                {
                    'value': 1,
                    'color': '#F5F5D4'
                },

            ]
        },
        'stoplight': {
            'name': 'Stoplight',
            'type': 'relative',
            'steps': [
                {
                    'value': 0,
                    'color': '#6d9b17'
                },
                {
                    'value': 0.5,
                    'color': '#fde74c'
                },
                {
                    'value': 1,
                    'color': '#cf0000'
                },
            ]
        },
        'white hot': {
            'name': 'White hot',
            'type': 'relative',
            'steps': [
                {
                    'value': 0,
                    'color': '#242124'
                },
                {
                    'value': 1,
                    'color': '#F5F5F5'
                }
            ]
        },
    }

    device_class_defaults = {
        'carbon_dioxide': 'carbon dioxide',
        'energy': 'iron red',
        'temperature': 'indoor temperature'
    }    
}

/* Home Assistant custodial stuff:
    - Register the card
    - Make it available in the card picker UI
*/
customElements.define("heatmap-card", HeatmapCard);
window.customCards = window.customCards || [];
window.customCards.push({
    type: "heatmap-card",
    name: "Heatmap card",
    preview: true,
    description: "Heat maps of entities or energy data",
});




/*
    8< 8< 8< 8< 8<
    Heatmap card code ends here; third party code included in file for ease of distribution.
    chroma.js 2.4.2 minimized
*/

/**
 * chroma.js - JavaScript library for color conversions
 *
 * Copyright (c) 2011-2019, Gregor Aisch
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 * list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 * this list of conditions and the following disclaimer in the documentation
 * and/or other materials provided with the distribution.
 *
 * 3. The name Gregor Aisch may not be used to endorse or promote products
 * derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL GREGOR AISCH OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
 * INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
 * BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 * NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
 * EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * -------------------------------------------------------
 *
 * chroma.js includes colors from colorbrewer2.org, which are released under
 * the following license:
 *
 * Copyright (c) 2002 Cynthia Brewer, Mark Harrower,
 * and The Pennsylvania State University.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
 * either express or implied. See the License for the specific
 * language governing permissions and limitations under the License.
 *
 * ------------------------------------------------------
 *
 * Named colors are taken from X11 Color Names.
 * http://www.w3.org/TR/css3-color/#svg-color
 *
 * @preserve
 */

 !function(r,e){"object"==typeof exports&&"undefined"!=typeof module?module.exports=e():"function"==typeof define&&define.amd?define(e):(r="undefined"!=typeof globalThis?globalThis:r||self).chroma=e()}(this,(function(){"use strict";for(var r=function(r,e,n){return void 0===e&&(e=0),void 0===n&&(n=1),r<e?e:r>n?n:r},e=r,n={},t=0,a=["Boolean","Number","String","Function","Array","Date","RegExp","Undefined","Null"];t<a.length;t+=1){var f=a[t];n["[object "+f+"]"]=f.toLowerCase()}var o=function(r){return n[Object.prototype.toString.call(r)]||"object"},u=o,c=o,i=Math.PI,l={clip_rgb:function(r){r._clipped=!1,r._unclipped=r.slice(0);for(var n=0;n<=3;n++)n<3?((r[n]<0||r[n]>255)&&(r._clipped=!0),r[n]=e(r[n],0,255)):3===n&&(r[n]=e(r[n],0,1));return r},limit:r,type:o,unpack:function(r,e){return void 0===e&&(e=null),r.length>=3?Array.prototype.slice.call(r):"object"==u(r[0])&&e?e.split("").filter((function(e){return void 0!==r[0][e]})).map((function(e){return r[0][e]})):r[0]},last:function(r){if(r.length<2)return null;var e=r.length-1;return"string"==c(r[e])?r[e].toLowerCase():null},PI:i,TWOPI:2*i,PITHIRD:i/3,DEG2RAD:i/180,RAD2DEG:180/i},h={format:{},autodetect:[]},s=l.last,d=l.clip_rgb,b=l.type,p=h,g=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];var n=this;if("object"===b(r[0])&&r[0].constructor&&r[0].constructor===this.constructor)return r[0];var t=s(r),a=!1;if(!t){a=!0,p.sorted||(p.autodetect=p.autodetect.sort((function(r,e){return e.p-r.p})),p.sorted=!0);for(var f=0,o=p.autodetect;f<o.length;f+=1){var u=o[f];if(t=u.test.apply(u,r))break}}if(!p.format[t])throw new Error("unknown format: "+r);var c=p.format[t].apply(null,a?r:r.slice(0,-1));n._rgb=d(c),3===n._rgb.length&&n._rgb.push(1)};g.prototype.toString=function(){return"function"==b(this.hex)?this.hex():"["+this._rgb.join(",")+"]"};var v=g,m=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];return new(Function.prototype.bind.apply(m.Color,[null].concat(r)))};m.Color=v,m.version="2.4.2";var y=m,k=l.unpack,w=Math.max,M=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];var n=k(r,"rgb"),t=n[0],a=n[1],f=n[2],o=1-w(t/=255,w(a/=255,f/=255)),u=o<1?1/(1-o):0,c=(1-t-o)*u,i=(1-a-o)*u,l=(1-f-o)*u;return[c,i,l,o]},N=l.unpack,_=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];var n=(r=N(r,"cmyk"))[0],t=r[1],a=r[2],f=r[3],o=r.length>4?r[4]:1;return 1===f?[0,0,0,o]:[n>=1?0:255*(1-n)*(1-f),t>=1?0:255*(1-t)*(1-f),a>=1?0:255*(1-a)*(1-f),o]},x=y,A=v,E=h,F=l.unpack,P=l.type,O=M;A.prototype.cmyk=function(){return O(this._rgb)},x.cmyk=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];return new(Function.prototype.bind.apply(A,[null].concat(r,["cmyk"])))},E.format.cmyk=_,E.autodetect.push({p:2,test:function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];if(r=F(r,"cmyk"),"array"===P(r)&&4===r.length)return"cmyk"}});var j=l.unpack,G=l.last,R=function(r){return Math.round(100*r)/100},q=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];var n=j(r,"hsla"),t=G(r)||"lsa";return n[0]=R(n[0]||0),n[1]=R(100*n[1])+"%",n[2]=R(100*n[2])+"%","hsla"===t||n.length>3&&n[3]<1?(n[3]=n.length>3?n[3]:1,t="hsla"):n.length=3,t+"("+n.join(",")+")"},L=l.unpack,I=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];var n=(r=L(r,"rgba"))[0],t=r[1],a=r[2];n/=255,t/=255,a/=255;var f,o,u=Math.min(n,t,a),c=Math.max(n,t,a),i=(c+u)/2;return c===u?(f=0,o=Number.NaN):f=i<.5?(c-u)/(c+u):(c-u)/(2-c-u),n==c?o=(t-a)/(c-u):t==c?o=2+(a-n)/(c-u):a==c&&(o=4+(n-t)/(c-u)),(o*=60)<0&&(o+=360),r.length>3&&void 0!==r[3]?[o,f,i,r[3]]:[o,f,i]},B=l.unpack,C=l.last,D=q,Y=I,S=Math.round,T=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];var n=B(r,"rgba"),t=C(r)||"rgb";return"hsl"==t.substr(0,3)?D(Y(n),t):(n[0]=S(n[0]),n[1]=S(n[1]),n[2]=S(n[2]),("rgba"===t||n.length>3&&n[3]<1)&&(n[3]=n.length>3?n[3]:1,t="rgba"),t+"("+n.slice(0,"rgb"===t?3:4).join(",")+")")},$=l.unpack,z=Math.round,X=function(){for(var r,e=[],n=arguments.length;n--;)e[n]=arguments[n];var t,a,f,o=(e=$(e,"hsl"))[0],u=e[1],c=e[2];if(0===u)t=a=f=255*c;else{var i=[0,0,0],l=[0,0,0],h=c<.5?c*(1+u):c+u-c*u,s=2*c-h,d=o/360;i[0]=d+1/3,i[1]=d,i[2]=d-1/3;for(var b=0;b<3;b++)i[b]<0&&(i[b]+=1),i[b]>1&&(i[b]-=1),6*i[b]<1?l[b]=s+6*(h-s)*i[b]:2*i[b]<1?l[b]=h:3*i[b]<2?l[b]=s+(h-s)*(2/3-i[b])*6:l[b]=s;t=(r=[z(255*l[0]),z(255*l[1]),z(255*l[2])])[0],a=r[1],f=r[2]}return e.length>3?[t,a,f,e[3]]:[t,a,f,1]},U=X,V=h,W=/^rgb\(\s*(-?\d+),\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/,K=/^rgba\(\s*(-?\d+),\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*([01]|[01]?\.\d+)\)$/,Z=/^rgb\(\s*(-?\d+(?:\.\d+)?)%,\s*(-?\d+(?:\.\d+)?)%\s*,\s*(-?\d+(?:\.\d+)?)%\s*\)$/,H=/^rgba\(\s*(-?\d+(?:\.\d+)?)%,\s*(-?\d+(?:\.\d+)?)%\s*,\s*(-?\d+(?:\.\d+)?)%\s*,\s*([01]|[01]?\.\d+)\)$/,J=/^hsl\(\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)%\s*,\s*(-?\d+(?:\.\d+)?)%\s*\)$/,Q=/^hsla\(\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)%\s*,\s*(-?\d+(?:\.\d+)?)%\s*,\s*([01]|[01]?\.\d+)\)$/,rr=Math.round,er=function(r){var e;if(r=r.toLowerCase().trim(),V.format.named)try{return V.format.named(r)}catch(r){}if(e=r.match(W)){for(var n=e.slice(1,4),t=0;t<3;t++)n[t]=+n[t];return n[3]=1,n}if(e=r.match(K)){for(var a=e.slice(1,5),f=0;f<4;f++)a[f]=+a[f];return a}if(e=r.match(Z)){for(var o=e.slice(1,4),u=0;u<3;u++)o[u]=rr(2.55*o[u]);return o[3]=1,o}if(e=r.match(H)){for(var c=e.slice(1,5),i=0;i<3;i++)c[i]=rr(2.55*c[i]);return c[3]=+c[3],c}if(e=r.match(J)){var l=e.slice(1,4);l[1]*=.01,l[2]*=.01;var h=U(l);return h[3]=1,h}if(e=r.match(Q)){var s=e.slice(1,4);s[1]*=.01,s[2]*=.01;var d=U(s);return d[3]=+e[4],d}};er.test=function(r){return W.test(r)||K.test(r)||Z.test(r)||H.test(r)||J.test(r)||Q.test(r)};var nr=y,tr=v,ar=h,fr=l.type,or=T,ur=er;tr.prototype.css=function(r){return or(this._rgb,r)},nr.css=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];return new(Function.prototype.bind.apply(tr,[null].concat(r,["css"])))},ar.format.css=ur,ar.autodetect.push({p:5,test:function(r){for(var e=[],n=arguments.length-1;n-- >0;)e[n]=arguments[n+1];if(!e.length&&"string"===fr(r)&&ur.test(r))return"css"}});var cr=v,ir=y,lr=l.unpack;h.format.gl=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];var n=lr(r,"rgba");return n[0]*=255,n[1]*=255,n[2]*=255,n},ir.gl=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];return new(Function.prototype.bind.apply(cr,[null].concat(r,["gl"])))},cr.prototype.gl=function(){var r=this._rgb;return[r[0]/255,r[1]/255,r[2]/255,r[3]]};var hr=l.unpack,sr=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];var n,t=hr(r,"rgb"),a=t[0],f=t[1],o=t[2],u=Math.min(a,f,o),c=Math.max(a,f,o),i=c-u,l=100*i/255,h=u/(255-i)*100;return 0===i?n=Number.NaN:(a===c&&(n=(f-o)/i),f===c&&(n=2+(o-a)/i),o===c&&(n=4+(a-f)/i),(n*=60)<0&&(n+=360)),[n,l,h]},dr=l.unpack,br=Math.floor,pr=function(){for(var r,e,n,t,a,f,o=[],u=arguments.length;u--;)o[u]=arguments[u];var c,i,l,h=(o=dr(o,"hcg"))[0],s=o[1],d=o[2];d*=255;var b=255*s;if(0===s)c=i=l=d;else{360===h&&(h=0),h>360&&(h-=360),h<0&&(h+=360);var p=br(h/=60),g=h-p,v=d*(1-s),m=v+b*(1-g),y=v+b*g,k=v+b;switch(p){case 0:c=(r=[k,y,v])[0],i=r[1],l=r[2];break;case 1:c=(e=[m,k,v])[0],i=e[1],l=e[2];break;case 2:c=(n=[v,k,y])[0],i=n[1],l=n[2];break;case 3:c=(t=[v,m,k])[0],i=t[1],l=t[2];break;case 4:c=(a=[y,v,k])[0],i=a[1],l=a[2];break;case 5:c=(f=[k,v,m])[0],i=f[1],l=f[2]}}return[c,i,l,o.length>3?o[3]:1]},gr=l.unpack,vr=l.type,mr=y,yr=v,kr=h,wr=sr;yr.prototype.hcg=function(){return wr(this._rgb)},mr.hcg=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];return new(Function.prototype.bind.apply(yr,[null].concat(r,["hcg"])))},kr.format.hcg=pr,kr.autodetect.push({p:1,test:function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];if(r=gr(r,"hcg"),"array"===vr(r)&&3===r.length)return"hcg"}});var Mr=l.unpack,Nr=l.last,_r=Math.round,xr=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];var n=Mr(r,"rgba"),t=n[0],a=n[1],f=n[2],o=n[3],u=Nr(r)||"auto";void 0===o&&(o=1),"auto"===u&&(u=o<1?"rgba":"rgb");var c=(t=_r(t))<<16|(a=_r(a))<<8|(f=_r(f)),i="000000"+c.toString(16);i=i.substr(i.length-6);var l="0"+_r(255*o).toString(16);switch(l=l.substr(l.length-2),u.toLowerCase()){case"rgba":return"#"+i+l;case"argb":return"#"+l+i;default:return"#"+i}},Ar=/^#?([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/,Er=/^#?([A-Fa-f0-9]{8}|[A-Fa-f0-9]{4})$/,Fr=function(r){if(r.match(Ar)){4!==r.length&&7!==r.length||(r=r.substr(1)),3===r.length&&(r=(r=r.split(""))[0]+r[0]+r[1]+r[1]+r[2]+r[2]);var e=parseInt(r,16);return[e>>16,e>>8&255,255&e,1]}if(r.match(Er)){5!==r.length&&9!==r.length||(r=r.substr(1)),4===r.length&&(r=(r=r.split(""))[0]+r[0]+r[1]+r[1]+r[2]+r[2]+r[3]+r[3]);var n=parseInt(r,16);return[n>>24&255,n>>16&255,n>>8&255,Math.round((255&n)/255*100)/100]}throw new Error("unknown hex color: "+r)},Pr=y,Or=v,jr=l.type,Gr=h,Rr=xr;Or.prototype.hex=function(r){return Rr(this._rgb,r)},Pr.hex=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];return new(Function.prototype.bind.apply(Or,[null].concat(r,["hex"])))},Gr.format.hex=Fr,Gr.autodetect.push({p:4,test:function(r){for(var e=[],n=arguments.length-1;n-- >0;)e[n]=arguments[n+1];if(!e.length&&"string"===jr(r)&&[3,4,5,6,7,8,9].indexOf(r.length)>=0)return"hex"}});var qr=l.unpack,Lr=l.TWOPI,Ir=Math.min,Br=Math.sqrt,Cr=Math.acos,Dr=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];var n,t=qr(r,"rgb"),a=t[0],f=t[1],o=t[2],u=Ir(a/=255,f/=255,o/=255),c=(a+f+o)/3,i=c>0?1-u/c:0;return 0===i?n=NaN:(n=(a-f+(a-o))/2,n/=Br((a-f)*(a-f)+(a-o)*(f-o)),n=Cr(n),o>f&&(n=Lr-n),n/=Lr),[360*n,i,c]},Yr=l.unpack,Sr=l.limit,Tr=l.TWOPI,$r=l.PITHIRD,zr=Math.cos,Xr=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];var n,t,a,f=(r=Yr(r,"hsi"))[0],o=r[1],u=r[2];return isNaN(f)&&(f=0),isNaN(o)&&(o=0),f>360&&(f-=360),f<0&&(f+=360),(f/=360)<1/3?t=1-((a=(1-o)/3)+(n=(1+o*zr(Tr*f)/zr($r-Tr*f))/3)):f<2/3?a=1-((n=(1-o)/3)+(t=(1+o*zr(Tr*(f-=1/3))/zr($r-Tr*f))/3)):n=1-((t=(1-o)/3)+(a=(1+o*zr(Tr*(f-=2/3))/zr($r-Tr*f))/3)),[255*(n=Sr(u*n*3)),255*(t=Sr(u*t*3)),255*(a=Sr(u*a*3)),r.length>3?r[3]:1]},Ur=l.unpack,Vr=l.type,Wr=y,Kr=v,Zr=h,Hr=Dr;Kr.prototype.hsi=function(){return Hr(this._rgb)},Wr.hsi=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];return new(Function.prototype.bind.apply(Kr,[null].concat(r,["hsi"])))},Zr.format.hsi=Xr,Zr.autodetect.push({p:2,test:function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];if(r=Ur(r,"hsi"),"array"===Vr(r)&&3===r.length)return"hsi"}});var Jr=l.unpack,Qr=l.type,re=y,ee=v,ne=h,te=I;ee.prototype.hsl=function(){return te(this._rgb)},re.hsl=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];return new(Function.prototype.bind.apply(ee,[null].concat(r,["hsl"])))},ne.format.hsl=X,ne.autodetect.push({p:2,test:function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];if(r=Jr(r,"hsl"),"array"===Qr(r)&&3===r.length)return"hsl"}});var ae=l.unpack,fe=Math.min,oe=Math.max,ue=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];var n,t,a,f=(r=ae(r,"rgb"))[0],o=r[1],u=r[2],c=fe(f,o,u),i=oe(f,o,u),l=i-c;return a=i/255,0===i?(n=Number.NaN,t=0):(t=l/i,f===i&&(n=(o-u)/l),o===i&&(n=2+(u-f)/l),u===i&&(n=4+(f-o)/l),(n*=60)<0&&(n+=360)),[n,t,a]},ce=l.unpack,ie=Math.floor,le=function(){for(var r,e,n,t,a,f,o=[],u=arguments.length;u--;)o[u]=arguments[u];var c,i,l,h=(o=ce(o,"hsv"))[0],s=o[1],d=o[2];if(d*=255,0===s)c=i=l=d;else{360===h&&(h=0),h>360&&(h-=360),h<0&&(h+=360);var b=ie(h/=60),p=h-b,g=d*(1-s),v=d*(1-s*p),m=d*(1-s*(1-p));switch(b){case 0:c=(r=[d,m,g])[0],i=r[1],l=r[2];break;case 1:c=(e=[v,d,g])[0],i=e[1],l=e[2];break;case 2:c=(n=[g,d,m])[0],i=n[1],l=n[2];break;case 3:c=(t=[g,v,d])[0],i=t[1],l=t[2];break;case 4:c=(a=[m,g,d])[0],i=a[1],l=a[2];break;case 5:c=(f=[d,g,v])[0],i=f[1],l=f[2]}}return[c,i,l,o.length>3?o[3]:1]},he=l.unpack,se=l.type,de=y,be=v,pe=h,ge=ue;be.prototype.hsv=function(){return ge(this._rgb)},de.hsv=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];return new(Function.prototype.bind.apply(be,[null].concat(r,["hsv"])))},pe.format.hsv=le,pe.autodetect.push({p:2,test:function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];if(r=he(r,"hsv"),"array"===se(r)&&3===r.length)return"hsv"}});var ve={Kn:18,Xn:.95047,Yn:1,Zn:1.08883,t0:.137931034,t1:.206896552,t2:.12841855,t3:.008856452},me=ve,ye=l.unpack,ke=Math.pow,we=function(r){return(r/=255)<=.04045?r/12.92:ke((r+.055)/1.055,2.4)},Me=function(r){return r>me.t3?ke(r,1/3):r/me.t2+me.t0},Ne=function(r,e,n){return r=we(r),e=we(e),n=we(n),[Me((.4124564*r+.3575761*e+.1804375*n)/me.Xn),Me((.2126729*r+.7151522*e+.072175*n)/me.Yn),Me((.0193339*r+.119192*e+.9503041*n)/me.Zn)]},_e=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];var n=ye(r,"rgb"),t=n[0],a=n[1],f=n[2],o=Ne(t,a,f),u=o[0],c=o[1],i=o[2],l=116*c-16;return[l<0?0:l,500*(u-c),200*(c-i)]},xe=ve,Ae=l.unpack,Ee=Math.pow,Fe=function(r){return 255*(r<=.00304?12.92*r:1.055*Ee(r,1/2.4)-.055)},Pe=function(r){return r>xe.t1?r*r*r:xe.t2*(r-xe.t0)},Oe=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];var n,t,a,f=(r=Ae(r,"lab"))[0],o=r[1],u=r[2];return t=(f+16)/116,n=isNaN(o)?t:t+o/500,a=isNaN(u)?t:t-u/200,t=xe.Yn*Pe(t),n=xe.Xn*Pe(n),a=xe.Zn*Pe(a),[Fe(3.2404542*n-1.5371385*t-.4985314*a),Fe(-.969266*n+1.8760108*t+.041556*a),Fe(.0556434*n-.2040259*t+1.0572252*a),r.length>3?r[3]:1]},je=l.unpack,Ge=l.type,Re=y,qe=v,Le=h,Ie=_e;qe.prototype.lab=function(){return Ie(this._rgb)},Re.lab=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];return new(Function.prototype.bind.apply(qe,[null].concat(r,["lab"])))},Le.format.lab=Oe,Le.autodetect.push({p:2,test:function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];if(r=je(r,"lab"),"array"===Ge(r)&&3===r.length)return"lab"}});var Be=l.unpack,Ce=l.RAD2DEG,De=Math.sqrt,Ye=Math.atan2,Se=Math.round,Te=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];var n=Be(r,"lab"),t=n[0],a=n[1],f=n[2],o=De(a*a+f*f),u=(Ye(f,a)*Ce+360)%360;return 0===Se(1e4*o)&&(u=Number.NaN),[t,o,u]},$e=l.unpack,ze=_e,Xe=Te,Ue=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];var n=$e(r,"rgb"),t=n[0],a=n[1],f=n[2],o=ze(t,a,f),u=o[0],c=o[1],i=o[2];return Xe(u,c,i)},Ve=l.unpack,We=l.DEG2RAD,Ke=Math.sin,Ze=Math.cos,He=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];var n=Ve(r,"lch"),t=n[0],a=n[1],f=n[2];return isNaN(f)&&(f=0),[t,Ze(f*=We)*a,Ke(f)*a]},Je=l.unpack,Qe=He,rn=Oe,en=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];var n=(r=Je(r,"lch"))[0],t=r[1],a=r[2],f=Qe(n,t,a),o=f[0],u=f[1],c=f[2],i=rn(o,u,c),l=i[0],h=i[1],s=i[2];return[l,h,s,r.length>3?r[3]:1]},nn=l.unpack,tn=en,an=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];var n=nn(r,"hcl").reverse();return tn.apply(void 0,n)},fn=l.unpack,on=l.type,un=y,cn=v,ln=h,hn=Ue;cn.prototype.lch=function(){return hn(this._rgb)},cn.prototype.hcl=function(){return hn(this._rgb).reverse()},un.lch=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];return new(Function.prototype.bind.apply(cn,[null].concat(r,["lch"])))},un.hcl=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];return new(Function.prototype.bind.apply(cn,[null].concat(r,["hcl"])))},ln.format.lch=en,ln.format.hcl=an,["lch","hcl"].forEach((function(r){return ln.autodetect.push({p:2,test:function(){for(var e=[],n=arguments.length;n--;)e[n]=arguments[n];if(e=fn(e,r),"array"===on(e)&&3===e.length)return r}})}));var sn={aliceblue:"#f0f8ff",antiquewhite:"#faebd7",aqua:"#00ffff",aquamarine:"#7fffd4",azure:"#f0ffff",beige:"#f5f5dc",bisque:"#ffe4c4",black:"#000000",blanchedalmond:"#ffebcd",blue:"#0000ff",blueviolet:"#8a2be2",brown:"#a52a2a",burlywood:"#deb887",cadetblue:"#5f9ea0",chartreuse:"#7fff00",chocolate:"#d2691e",coral:"#ff7f50",cornflower:"#6495ed",cornflowerblue:"#6495ed",cornsilk:"#fff8dc",crimson:"#dc143c",cyan:"#00ffff",darkblue:"#00008b",darkcyan:"#008b8b",darkgoldenrod:"#b8860b",darkgray:"#a9a9a9",darkgreen:"#006400",darkgrey:"#a9a9a9",darkkhaki:"#bdb76b",darkmagenta:"#8b008b",darkolivegreen:"#556b2f",darkorange:"#ff8c00",darkorchid:"#9932cc",darkred:"#8b0000",darksalmon:"#e9967a",darkseagreen:"#8fbc8f",darkslateblue:"#483d8b",darkslategray:"#2f4f4f",darkslategrey:"#2f4f4f",darkturquoise:"#00ced1",darkviolet:"#9400d3",deeppink:"#ff1493",deepskyblue:"#00bfff",dimgray:"#696969",dimgrey:"#696969",dodgerblue:"#1e90ff",firebrick:"#b22222",floralwhite:"#fffaf0",forestgreen:"#228b22",fuchsia:"#ff00ff",gainsboro:"#dcdcdc",ghostwhite:"#f8f8ff",gold:"#ffd700",goldenrod:"#daa520",gray:"#808080",green:"#008000",greenyellow:"#adff2f",grey:"#808080",honeydew:"#f0fff0",hotpink:"#ff69b4",indianred:"#cd5c5c",indigo:"#4b0082",ivory:"#fffff0",khaki:"#f0e68c",laserlemon:"#ffff54",lavender:"#e6e6fa",lavenderblush:"#fff0f5",lawngreen:"#7cfc00",lemonchiffon:"#fffacd",lightblue:"#add8e6",lightcoral:"#f08080",lightcyan:"#e0ffff",lightgoldenrod:"#fafad2",lightgoldenrodyellow:"#fafad2",lightgray:"#d3d3d3",lightgreen:"#90ee90",lightgrey:"#d3d3d3",lightpink:"#ffb6c1",lightsalmon:"#ffa07a",lightseagreen:"#20b2aa",lightskyblue:"#87cefa",lightslategray:"#778899",lightslategrey:"#778899",lightsteelblue:"#b0c4de",lightyellow:"#ffffe0",lime:"#00ff00",limegreen:"#32cd32",linen:"#faf0e6",magenta:"#ff00ff",maroon:"#800000",maroon2:"#7f0000",maroon3:"#b03060",mediumaquamarine:"#66cdaa",mediumblue:"#0000cd",mediumorchid:"#ba55d3",mediumpurple:"#9370db",mediumseagreen:"#3cb371",mediumslateblue:"#7b68ee",mediumspringgreen:"#00fa9a",mediumturquoise:"#48d1cc",mediumvioletred:"#c71585",midnightblue:"#191970",mintcream:"#f5fffa",mistyrose:"#ffe4e1",moccasin:"#ffe4b5",navajowhite:"#ffdead",navy:"#000080",oldlace:"#fdf5e6",olive:"#808000",olivedrab:"#6b8e23",orange:"#ffa500",orangered:"#ff4500",orchid:"#da70d6",palegoldenrod:"#eee8aa",palegreen:"#98fb98",paleturquoise:"#afeeee",palevioletred:"#db7093",papayawhip:"#ffefd5",peachpuff:"#ffdab9",peru:"#cd853f",pink:"#ffc0cb",plum:"#dda0dd",powderblue:"#b0e0e6",purple:"#800080",purple2:"#7f007f",purple3:"#a020f0",rebeccapurple:"#663399",red:"#ff0000",rosybrown:"#bc8f8f",royalblue:"#4169e1",saddlebrown:"#8b4513",salmon:"#fa8072",sandybrown:"#f4a460",seagreen:"#2e8b57",seashell:"#fff5ee",sienna:"#a0522d",silver:"#c0c0c0",skyblue:"#87ceeb",slateblue:"#6a5acd",slategray:"#708090",slategrey:"#708090",snow:"#fffafa",springgreen:"#00ff7f",steelblue:"#4682b4",tan:"#d2b48c",teal:"#008080",thistle:"#d8bfd8",tomato:"#ff6347",turquoise:"#40e0d0",violet:"#ee82ee",wheat:"#f5deb3",white:"#ffffff",whitesmoke:"#f5f5f5",yellow:"#ffff00",yellowgreen:"#9acd32"},dn=h,bn=l.type,pn=sn,gn=Fr,vn=xr;v.prototype.name=function(){for(var r=vn(this._rgb,"rgb"),e=0,n=Object.keys(pn);e<n.length;e+=1){var t=n[e];if(pn[t]===r)return t.toLowerCase()}return r},dn.format.named=function(r){if(r=r.toLowerCase(),pn[r])return gn(pn[r]);throw new Error("unknown color name: "+r)},dn.autodetect.push({p:5,test:function(r){for(var e=[],n=arguments.length-1;n-- >0;)e[n]=arguments[n+1];if(!e.length&&"string"===bn(r)&&pn[r.toLowerCase()])return"named"}});var mn=l.unpack,yn=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];var n=mn(r,"rgb"),t=n[0],a=n[1],f=n[2];return(t<<16)+(a<<8)+f},kn=l.type,wn=function(r){if("number"==kn(r)&&r>=0&&r<=16777215)return[r>>16,r>>8&255,255&r,1];throw new Error("unknown num color: "+r)},Mn=y,Nn=v,_n=h,xn=l.type,An=yn;Nn.prototype.num=function(){return An(this._rgb)},Mn.num=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];return new(Function.prototype.bind.apply(Nn,[null].concat(r,["num"])))},_n.format.num=wn,_n.autodetect.push({p:5,test:function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];if(1===r.length&&"number"===xn(r[0])&&r[0]>=0&&r[0]<=16777215)return"num"}});var En=y,Fn=v,Pn=h,On=l.unpack,jn=l.type,Gn=Math.round;Fn.prototype.rgb=function(r){return void 0===r&&(r=!0),!1===r?this._rgb.slice(0,3):this._rgb.slice(0,3).map(Gn)},Fn.prototype.rgba=function(r){return void 0===r&&(r=!0),this._rgb.slice(0,4).map((function(e,n){return n<3?!1===r?e:Gn(e):e}))},En.rgb=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];return new(Function.prototype.bind.apply(Fn,[null].concat(r,["rgb"])))},Pn.format.rgb=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];var n=On(r,"rgba");return void 0===n[3]&&(n[3]=1),n},Pn.autodetect.push({p:3,test:function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];if(r=On(r,"rgba"),"array"===jn(r)&&(3===r.length||4===r.length&&"number"==jn(r[3])&&r[3]>=0&&r[3]<=1))return"rgb"}});var Rn=Math.log,qn=function(r){var e,n,t,a=r/100;return a<66?(e=255,n=a<6?0:-155.25485562709179-.44596950469579133*(n=a-2)+104.49216199393888*Rn(n),t=a<20?0:.8274096064007395*(t=a-10)-254.76935184120902+115.67994401066147*Rn(t)):(e=351.97690566805693+.114206453784165*(e=a-55)-40.25366309332127*Rn(e),n=325.4494125711974+.07943456536662342*(n=a-50)-28.0852963507957*Rn(n),t=255),[e,n,t,1]},Ln=qn,In=l.unpack,Bn=Math.round,Cn=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];for(var n,t=In(r,"rgb"),a=t[0],f=t[2],o=1e3,u=4e4,c=.4;u-o>c;){var i=Ln(n=.5*(u+o));i[2]/i[0]>=f/a?u=n:o=n}return Bn(n)},Dn=y,Yn=v,Sn=h,Tn=Cn;Yn.prototype.temp=Yn.prototype.kelvin=Yn.prototype.temperature=function(){return Tn(this._rgb)},Dn.temp=Dn.kelvin=Dn.temperature=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];return new(Function.prototype.bind.apply(Yn,[null].concat(r,["temp"])))},Sn.format.temp=Sn.format.kelvin=Sn.format.temperature=qn;var $n=l.unpack,zn=Math.cbrt,Xn=Math.pow,Un=Math.sign,Vn=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];var n=$n(r,"rgb"),t=n[0],a=n[1],f=n[2],o=[Wn(t/255),Wn(a/255),Wn(f/255)],u=o[0],c=o[1],i=o[2],l=zn(.4122214708*u+.5363325363*c+.0514459929*i),h=zn(.2119034982*u+.6806995451*c+.1073969566*i),s=zn(.0883024619*u+.2817188376*c+.6299787005*i);return[.2104542553*l+.793617785*h-.0040720468*s,1.9779984951*l-2.428592205*h+.4505937099*s,.0259040371*l+.7827717662*h-.808675766*s]};function Wn(r){var e=Math.abs(r);return e<.04045?r/12.92:(Un(r)||1)*Xn((e+.055)/1.055,2.4)}var Kn=l.unpack,Zn=Math.pow,Hn=Math.sign,Jn=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];var n=(r=Kn(r,"lab"))[0],t=r[1],a=r[2],f=Zn(n+.3963377774*t+.2158037573*a,3),o=Zn(n-.1055613458*t-.0638541728*a,3),u=Zn(n-.0894841775*t-1.291485548*a,3);return[255*Qn(4.0767416621*f-3.3077115913*o+.2309699292*u),255*Qn(-1.2684380046*f+2.6097574011*o-.3413193965*u),255*Qn(-.0041960863*f-.7034186147*o+1.707614701*u),r.length>3?r[3]:1]};function Qn(r){var e=Math.abs(r);return e>.0031308?(Hn(r)||1)*(1.055*Zn(e,1/2.4)-.055):12.92*r}var rt=l.unpack,et=l.type,nt=y,tt=v,at=h,ft=Vn;tt.prototype.oklab=function(){return ft(this._rgb)},nt.oklab=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];return new(Function.prototype.bind.apply(tt,[null].concat(r,["oklab"])))},at.format.oklab=Jn,at.autodetect.push({p:3,test:function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];if(r=rt(r,"oklab"),"array"===et(r)&&3===r.length)return"oklab"}});var ot=l.unpack,ut=Vn,ct=Te,it=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];var n=ot(r,"rgb"),t=n[0],a=n[1],f=n[2],o=ut(t,a,f),u=o[0],c=o[1],i=o[2];return ct(u,c,i)},lt=l.unpack,ht=He,st=Jn,dt=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];var n=(r=lt(r,"lch"))[0],t=r[1],a=r[2],f=ht(n,t,a),o=f[0],u=f[1],c=f[2],i=st(o,u,c),l=i[0],h=i[1],s=i[2];return[l,h,s,r.length>3?r[3]:1]},bt=l.unpack,pt=l.type,gt=y,vt=v,mt=h,yt=it;vt.prototype.oklch=function(){return yt(this._rgb)},gt.oklch=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];return new(Function.prototype.bind.apply(vt,[null].concat(r,["oklch"])))},mt.format.oklch=dt,mt.autodetect.push({p:3,test:function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];if(r=bt(r,"oklch"),"array"===pt(r)&&3===r.length)return"oklch"}});var kt=v,wt=l.type;kt.prototype.alpha=function(r,e){return void 0===e&&(e=!1),void 0!==r&&"number"===wt(r)?e?(this._rgb[3]=r,this):new kt([this._rgb[0],this._rgb[1],this._rgb[2],r],"rgb"):this._rgb[3]},v.prototype.clipped=function(){return this._rgb._clipped||!1};var Mt=v,Nt=ve;Mt.prototype.darken=function(r){void 0===r&&(r=1);var e=this.lab();return e[0]-=Nt.Kn*r,new Mt(e,"lab").alpha(this.alpha(),!0)},Mt.prototype.brighten=function(r){return void 0===r&&(r=1),this.darken(-r)},Mt.prototype.darker=Mt.prototype.darken,Mt.prototype.brighter=Mt.prototype.brighten,v.prototype.get=function(r){var e=r.split("."),n=e[0],t=e[1],a=this[n]();if(t){var f=n.indexOf(t)-("ok"===n.substr(0,2)?2:0);if(f>-1)return a[f];throw new Error("unknown channel "+t+" in mode "+n)}return a};var _t=v,xt=l.type,At=Math.pow;_t.prototype.luminance=function(r){if(void 0!==r&&"number"===xt(r)){if(0===r)return new _t([0,0,0,this._rgb[3]],"rgb");if(1===r)return new _t([255,255,255,this._rgb[3]],"rgb");var e=this.luminance(),n=20,t=function(e,a){var f=e.interpolate(a,.5,"rgb"),o=f.luminance();return Math.abs(r-o)<1e-7||!n--?f:o>r?t(e,f):t(f,a)},a=(e>r?t(new _t([0,0,0]),this):t(this,new _t([255,255,255]))).rgb();return new _t(a.concat([this._rgb[3]]))}return Et.apply(void 0,this._rgb.slice(0,3))};var Et=function(r,e,n){return.2126*(r=Ft(r))+.7152*(e=Ft(e))+.0722*(n=Ft(n))},Ft=function(r){return(r/=255)<=.03928?r/12.92:At((r+.055)/1.055,2.4)},Pt={},Ot=v,jt=l.type,Gt=Pt,Rt=function(r,e,n){void 0===n&&(n=.5);for(var t=[],a=arguments.length-3;a-- >0;)t[a]=arguments[a+3];var f=t[0]||"lrgb";if(Gt[f]||t.length||(f=Object.keys(Gt)[0]),!Gt[f])throw new Error("interpolation mode "+f+" is not defined");return"object"!==jt(r)&&(r=new Ot(r)),"object"!==jt(e)&&(e=new Ot(e)),Gt[f](r,e,n).alpha(r.alpha()+n*(e.alpha()-r.alpha()))},qt=v,Lt=Rt;qt.prototype.mix=qt.prototype.interpolate=function(r,e){void 0===e&&(e=.5);for(var n=[],t=arguments.length-2;t-- >0;)n[t]=arguments[t+2];return Lt.apply(void 0,[this,r,e].concat(n))};var It=v;It.prototype.premultiply=function(r){void 0===r&&(r=!1);var e=this._rgb,n=e[3];return r?(this._rgb=[e[0]*n,e[1]*n,e[2]*n,n],this):new It([e[0]*n,e[1]*n,e[2]*n,n],"rgb")};var Bt=v,Ct=ve;Bt.prototype.saturate=function(r){void 0===r&&(r=1);var e=this.lch();return e[1]+=Ct.Kn*r,e[1]<0&&(e[1]=0),new Bt(e,"lch").alpha(this.alpha(),!0)},Bt.prototype.desaturate=function(r){return void 0===r&&(r=1),this.saturate(-r)};var Dt=v,Yt=l.type;Dt.prototype.set=function(r,e,n){void 0===n&&(n=!1);var t=r.split("."),a=t[0],f=t[1],o=this[a]();if(f){var u=a.indexOf(f)-("ok"===a.substr(0,2)?2:0);if(u>-1){if("string"==Yt(e))switch(e.charAt(0)){case"+":case"-":o[u]+=+e;break;case"*":o[u]*=+e.substr(1);break;case"/":o[u]/=+e.substr(1);break;default:o[u]=+e}else{if("number"!==Yt(e))throw new Error("unsupported value for Color.set");o[u]=e}var c=new Dt(o,a);return n?(this._rgb=c._rgb,this):c}throw new Error("unknown channel "+f+" in mode "+a)}return o};var St=v;Pt.rgb=function(r,e,n){var t=r._rgb,a=e._rgb;return new St(t[0]+n*(a[0]-t[0]),t[1]+n*(a[1]-t[1]),t[2]+n*(a[2]-t[2]),"rgb")};var Tt=v,$t=Math.sqrt,zt=Math.pow;Pt.lrgb=function(r,e,n){var t=r._rgb,a=t[0],f=t[1],o=t[2],u=e._rgb,c=u[0],i=u[1],l=u[2];return new Tt($t(zt(a,2)*(1-n)+zt(c,2)*n),$t(zt(f,2)*(1-n)+zt(i,2)*n),$t(zt(o,2)*(1-n)+zt(l,2)*n),"rgb")};var Xt=v;Pt.lab=function(r,e,n){var t=r.lab(),a=e.lab();return new Xt(t[0]+n*(a[0]-t[0]),t[1]+n*(a[1]-t[1]),t[2]+n*(a[2]-t[2]),"lab")};var Ut=v,Vt=function(r,e,n,t){var a,f,o,u,c,i,l,h,s,d,b,p,g;return"hsl"===t?(o=r.hsl(),u=e.hsl()):"hsv"===t?(o=r.hsv(),u=e.hsv()):"hcg"===t?(o=r.hcg(),u=e.hcg()):"hsi"===t?(o=r.hsi(),u=e.hsi()):"lch"===t||"hcl"===t?(t="hcl",o=r.hcl(),u=e.hcl()):"oklch"===t&&(o=r.oklch().reverse(),u=e.oklch().reverse()),"h"!==t.substr(0,1)&&"oklch"!==t||(c=(a=o)[0],l=a[1],s=a[2],i=(f=u)[0],h=f[1],d=f[2]),isNaN(c)||isNaN(i)?isNaN(c)?isNaN(i)?p=Number.NaN:(p=i,1!=s&&0!=s||"hsv"==t||(b=h)):(p=c,1!=d&&0!=d||"hsv"==t||(b=l)):p=c+n*(i>c&&i-c>180?i-(c+360):i<c&&c-i>180?i+360-c:i-c),void 0===b&&(b=l+n*(h-l)),g=s+n*(d-s),new Ut("oklch"===t?[g,b,p]:[p,b,g],t)},Wt=Vt,Kt=function(r,e,n){return Wt(r,e,n,"lch")};Pt.lch=Kt,Pt.hcl=Kt;var Zt=v;Pt.num=function(r,e,n){var t=r.num(),a=e.num();return new Zt(t+n*(a-t),"num")};var Ht=Vt;Pt.hcg=function(r,e,n){return Ht(r,e,n,"hcg")};var Jt=Vt;Pt.hsi=function(r,e,n){return Jt(r,e,n,"hsi")};var Qt=Vt;Pt.hsl=function(r,e,n){return Qt(r,e,n,"hsl")};var ra=Vt;Pt.hsv=function(r,e,n){return ra(r,e,n,"hsv")};var ea=v;Pt.oklab=function(r,e,n){var t=r.oklab(),a=e.oklab();return new ea(t[0]+n*(a[0]-t[0]),t[1]+n*(a[1]-t[1]),t[2]+n*(a[2]-t[2]),"oklab")};var na=Vt;Pt.oklch=function(r,e,n){return na(r,e,n,"oklch")};var ta=v,aa=l.clip_rgb,fa=Math.pow,oa=Math.sqrt,ua=Math.PI,ca=Math.cos,ia=Math.sin,la=Math.atan2,ha=function(r,e){for(var n=r.length,t=[0,0,0,0],a=0;a<r.length;a++){var f=r[a],o=e[a]/n,u=f._rgb;t[0]+=fa(u[0],2)*o,t[1]+=fa(u[1],2)*o,t[2]+=fa(u[2],2)*o,t[3]+=u[3]*o}return t[0]=oa(t[0]),t[1]=oa(t[1]),t[2]=oa(t[2]),t[3]>.9999999&&(t[3]=1),new ta(aa(t))},sa=y,da=l.type,ba=Math.pow,pa=function(r){var e="rgb",n=sa("#ccc"),t=0,a=[0,1],f=[],o=[0,0],u=!1,c=[],i=!1,l=0,h=1,s=!1,d={},b=!0,p=1,g=function(r){if((r=r||["#fff","#000"])&&"string"===da(r)&&sa.brewer&&sa.brewer[r.toLowerCase()]&&(r=sa.brewer[r.toLowerCase()]),"array"===da(r)){1===r.length&&(r=[r[0],r[0]]),r=r.slice(0);for(var e=0;e<r.length;e++)r[e]=sa(r[e]);f.length=0;for(var n=0;n<r.length;n++)f.push(n/(r.length-1))}return k(),c=r},v=function(r){return r},m=function(r){return r},y=function(r,t){var a,i;if(null==t&&(t=!1),isNaN(r)||null===r)return n;if(t)i=r;else if(u&&u.length>2){var s=function(r){if(null!=u){for(var e=u.length-1,n=0;n<e&&r>=u[n];)n++;return n-1}return 0}(r);i=s/(u.length-2)}else i=h!==l?(r-l)/(h-l):1;i=m(i),t||(i=v(i)),1!==p&&(i=ba(i,p)),i=o[0]+i*(1-o[0]-o[1]),i=Math.min(1,Math.max(0,i));var g=Math.floor(1e4*i);if(b&&d[g])a=d[g];else{if("array"===da(c))for(var y=0;y<f.length;y++){var k=f[y];if(i<=k){a=c[y];break}if(i>=k&&y===f.length-1){a=c[y];break}if(i>k&&i<f[y+1]){i=(i-k)/(f[y+1]-k),a=sa.interpolate(c[y],c[y+1],i,e);break}}else"function"===da(c)&&(a=c(i));b&&(d[g]=a)}return a},k=function(){return d={}};g(r);var w=function(r){var e=sa(y(r));return i&&e[i]?e[i]():e};return w.classes=function(r){if(null!=r){if("array"===da(r))u=r,a=[r[0],r[r.length-1]];else{var e=sa.analyze(a);u=0===r?[e.min,e.max]:sa.limits(e,"e",r)}return w}return u},w.domain=function(r){if(!arguments.length)return a;l=r[0],h=r[r.length-1],f=[];var e=c.length;if(r.length===e&&l!==h)for(var n=0,t=Array.from(r);n<t.length;n+=1){var o=t[n];f.push((o-l)/(h-l))}else{for(var u=0;u<e;u++)f.push(u/(e-1));if(r.length>2){var i=r.map((function(e,n){return n/(r.length-1)})),s=r.map((function(r){return(r-l)/(h-l)}));s.every((function(r,e){return i[e]===r}))||(m=function(r){if(r<=0||r>=1)return r;for(var e=0;r>=s[e+1];)e++;var n=(r-s[e])/(s[e+1]-s[e]);return i[e]+n*(i[e+1]-i[e])})}}return a=[l,h],w},w.mode=function(r){return arguments.length?(e=r,k(),w):e},w.range=function(r,e){return g(r),w},w.out=function(r){return i=r,w},w.spread=function(r){return arguments.length?(t=r,w):t},w.correctLightness=function(r){return null==r&&(r=!0),s=r,k(),v=s?function(r){for(var e=y(0,!0).lab()[0],n=y(1,!0).lab()[0],t=e>n,a=y(r,!0).lab()[0],f=e+(n-e)*r,o=a-f,u=0,c=1,i=20;Math.abs(o)>.01&&i-- >0;)t&&(o*=-1),o<0?(u=r,r+=.5*(c-r)):(c=r,r+=.5*(u-r)),a=y(r,!0).lab()[0],o=a-f;return r}:function(r){return r},w},w.padding=function(r){return null!=r?("number"===da(r)&&(r=[r,r]),o=r,w):o},w.colors=function(e,n){arguments.length<2&&(n="hex");var t=[];if(0===arguments.length)t=c.slice(0);else if(1===e)t=[w(.5)];else if(e>1){var f=a[0],o=a[1]-f;t=ga(0,e,!1).map((function(r){return w(f+r/(e-1)*o)}))}else{r=[];var i=[];if(u&&u.length>2)for(var l=1,h=u.length,s=1<=h;s?l<h:l>h;s?l++:l--)i.push(.5*(u[l-1]+u[l]));else i=a;t=i.map((function(r){return w(r)}))}return sa[n]&&(t=t.map((function(r){return r[n]()}))),t},w.cache=function(r){return null!=r?(b=r,w):b},w.gamma=function(r){return null!=r?(p=r,w):p},w.nodata=function(r){return null!=r?(n=sa(r),w):n},w};function ga(r,e,n){for(var t=[],a=r<e,f=n?a?e+1:e-1:e,o=r;a?o<f:o>f;a?o++:o--)t.push(o);return t}var va=v,ma=pa,ya=y,ka=function(r,e,n){if(!ka[n])throw new Error("unknown blend mode "+n);return ka[n](r,e)},wa=function(r){return function(e,n){var t=ya(n).rgb(),a=ya(e).rgb();return ya.rgb(r(t,a))}},Ma=function(r){return function(e,n){var t=[];return t[0]=r(e[0],n[0]),t[1]=r(e[1],n[1]),t[2]=r(e[2],n[2]),t}};ka.normal=wa(Ma((function(r){return r}))),ka.multiply=wa(Ma((function(r,e){return r*e/255}))),ka.screen=wa(Ma((function(r,e){return 255*(1-(1-r/255)*(1-e/255))}))),ka.overlay=wa(Ma((function(r,e){return e<128?2*r*e/255:255*(1-2*(1-r/255)*(1-e/255))}))),ka.darken=wa(Ma((function(r,e){return r>e?e:r}))),ka.lighten=wa(Ma((function(r,e){return r>e?r:e}))),ka.dodge=wa(Ma((function(r,e){return 255===r||(r=e/255*255/(1-r/255))>255?255:r}))),ka.burn=wa(Ma((function(r,e){return 255*(1-(1-e/255)/(r/255))})));for(var Na=ka,_a=l.type,xa=l.clip_rgb,Aa=l.TWOPI,Ea=Math.pow,Fa=Math.sin,Pa=Math.cos,Oa=y,ja=v,Ga=Math.floor,Ra=Math.random,qa=o,La=Math.log,Ia=Math.pow,Ba=Math.floor,Ca=Math.abs,Da=function(r,e){void 0===e&&(e=null);var n={min:Number.MAX_VALUE,max:-1*Number.MAX_VALUE,sum:0,values:[],count:0};return"object"===qa(r)&&(r=Object.values(r)),r.forEach((function(r){e&&"object"===qa(r)&&(r=r[e]),null==r||isNaN(r)||(n.values.push(r),n.sum+=r,r<n.min&&(n.min=r),r>n.max&&(n.max=r),n.count+=1)})),n.domain=[n.min,n.max],n.limits=function(r,e){return Ya(n,r,e)},n},Ya=function(r,e,n){void 0===e&&(e="equal"),void 0===n&&(n=7),"array"==qa(r)&&(r=Da(r));var t=r.min,a=r.max,f=r.values.sort((function(r,e){return r-e}));if(1===n)return[t,a];var o=[];if("c"===e.substr(0,1)&&(o.push(t),o.push(a)),"e"===e.substr(0,1)){o.push(t);for(var u=1;u<n;u++)o.push(t+u/n*(a-t));o.push(a)}else if("l"===e.substr(0,1)){if(t<=0)throw new Error("Logarithmic scales are only possible for values > 0");var c=Math.LOG10E*La(t),i=Math.LOG10E*La(a);o.push(t);for(var l=1;l<n;l++)o.push(Ia(10,c+l/n*(i-c)));o.push(a)}else if("q"===e.substr(0,1)){o.push(t);for(var h=1;h<n;h++){var s=(f.length-1)*h/n,d=Ba(s);if(d===s)o.push(f[d]);else{var b=s-d;o.push(f[d]*(1-b)+f[d+1]*b)}}o.push(a)}else if("k"===e.substr(0,1)){var p,g=f.length,v=new Array(g),m=new Array(n),y=!0,k=0,w=null;(w=[]).push(t);for(var M=1;M<n;M++)w.push(t+M/n*(a-t));for(w.push(a);y;){for(var N=0;N<n;N++)m[N]=0;for(var _=0;_<g;_++)for(var x=f[_],A=Number.MAX_VALUE,E=void 0,F=0;F<n;F++){var P=Ca(w[F]-x);P<A&&(A=P,E=F),m[E]++,v[_]=E}for(var O=new Array(n),j=0;j<n;j++)O[j]=null;for(var G=0;G<g;G++)null===O[p=v[G]]?O[p]=f[G]:O[p]+=f[G];for(var R=0;R<n;R++)O[R]*=1/m[R];y=!1;for(var q=0;q<n;q++)if(O[q]!==w[q]){y=!0;break}w=O,++k>200&&(y=!1)}for(var L={},I=0;I<n;I++)L[I]=[];for(var B=0;B<g;B++)L[p=v[B]].push(f[B]);for(var C=[],D=0;D<n;D++)C.push(L[D][0]),C.push(L[D][L[D].length-1]);C=C.sort((function(r,e){return r-e})),o.push(C[0]);for(var Y=1;Y<C.length;Y+=2){var S=C[Y];isNaN(S)||-1!==o.indexOf(S)||o.push(S)}}return o},Sa={analyze:Da,limits:Ya},Ta=v,$a=v,za=Math.sqrt,Xa=Math.pow,Ua=Math.min,Va=Math.max,Wa=Math.atan2,Ka=Math.abs,Za=Math.cos,Ha=Math.sin,Ja=Math.exp,Qa=Math.PI,rf=v,ef=v,nf=y,tf=pa,af={cool:function(){return tf([nf.hsl(180,1,.9),nf.hsl(250,.7,.4)])},hot:function(){return tf(["#000","#f00","#ff0","#fff"]).mode("rgb")}},ff={OrRd:["#fff7ec","#fee8c8","#fdd49e","#fdbb84","#fc8d59","#ef6548","#d7301f","#b30000","#7f0000"],PuBu:["#fff7fb","#ece7f2","#d0d1e6","#a6bddb","#74a9cf","#3690c0","#0570b0","#045a8d","#023858"],BuPu:["#f7fcfd","#e0ecf4","#bfd3e6","#9ebcda","#8c96c6","#8c6bb1","#88419d","#810f7c","#4d004b"],Oranges:["#fff5eb","#fee6ce","#fdd0a2","#fdae6b","#fd8d3c","#f16913","#d94801","#a63603","#7f2704"],BuGn:["#f7fcfd","#e5f5f9","#ccece6","#99d8c9","#66c2a4","#41ae76","#238b45","#006d2c","#00441b"],YlOrBr:["#ffffe5","#fff7bc","#fee391","#fec44f","#fe9929","#ec7014","#cc4c02","#993404","#662506"],YlGn:["#ffffe5","#f7fcb9","#d9f0a3","#addd8e","#78c679","#41ab5d","#238443","#006837","#004529"],Reds:["#fff5f0","#fee0d2","#fcbba1","#fc9272","#fb6a4a","#ef3b2c","#cb181d","#a50f15","#67000d"],RdPu:["#fff7f3","#fde0dd","#fcc5c0","#fa9fb5","#f768a1","#dd3497","#ae017e","#7a0177","#49006a"],Greens:["#f7fcf5","#e5f5e0","#c7e9c0","#a1d99b","#74c476","#41ab5d","#238b45","#006d2c","#00441b"],YlGnBu:["#ffffd9","#edf8b1","#c7e9b4","#7fcdbb","#41b6c4","#1d91c0","#225ea8","#253494","#081d58"],Purples:["#fcfbfd","#efedf5","#dadaeb","#bcbddc","#9e9ac8","#807dba","#6a51a3","#54278f","#3f007d"],GnBu:["#f7fcf0","#e0f3db","#ccebc5","#a8ddb5","#7bccc4","#4eb3d3","#2b8cbe","#0868ac","#084081"],Greys:["#ffffff","#f0f0f0","#d9d9d9","#bdbdbd","#969696","#737373","#525252","#252525","#000000"],YlOrRd:["#ffffcc","#ffeda0","#fed976","#feb24c","#fd8d3c","#fc4e2a","#e31a1c","#bd0026","#800026"],PuRd:["#f7f4f9","#e7e1ef","#d4b9da","#c994c7","#df65b0","#e7298a","#ce1256","#980043","#67001f"],Blues:["#f7fbff","#deebf7","#c6dbef","#9ecae1","#6baed6","#4292c6","#2171b5","#08519c","#08306b"],PuBuGn:["#fff7fb","#ece2f0","#d0d1e6","#a6bddb","#67a9cf","#3690c0","#02818a","#016c59","#014636"],Viridis:["#440154","#482777","#3f4a8a","#31678e","#26838f","#1f9d8a","#6cce5a","#b6de2b","#fee825"],Spectral:["#9e0142","#d53e4f","#f46d43","#fdae61","#fee08b","#ffffbf","#e6f598","#abdda4","#66c2a5","#3288bd","#5e4fa2"],RdYlGn:["#a50026","#d73027","#f46d43","#fdae61","#fee08b","#ffffbf","#d9ef8b","#a6d96a","#66bd63","#1a9850","#006837"],RdBu:["#67001f","#b2182b","#d6604d","#f4a582","#fddbc7","#f7f7f7","#d1e5f0","#92c5de","#4393c3","#2166ac","#053061"],PiYG:["#8e0152","#c51b7d","#de77ae","#f1b6da","#fde0ef","#f7f7f7","#e6f5d0","#b8e186","#7fbc41","#4d9221","#276419"],PRGn:["#40004b","#762a83","#9970ab","#c2a5cf","#e7d4e8","#f7f7f7","#d9f0d3","#a6dba0","#5aae61","#1b7837","#00441b"],RdYlBu:["#a50026","#d73027","#f46d43","#fdae61","#fee090","#ffffbf","#e0f3f8","#abd9e9","#74add1","#4575b4","#313695"],BrBG:["#543005","#8c510a","#bf812d","#dfc27d","#f6e8c3","#f5f5f5","#c7eae5","#80cdc1","#35978f","#01665e","#003c30"],RdGy:["#67001f","#b2182b","#d6604d","#f4a582","#fddbc7","#ffffff","#e0e0e0","#bababa","#878787","#4d4d4d","#1a1a1a"],PuOr:["#7f3b08","#b35806","#e08214","#fdb863","#fee0b6","#f7f7f7","#d8daeb","#b2abd2","#8073ac","#542788","#2d004b"],Set2:["#66c2a5","#fc8d62","#8da0cb","#e78ac3","#a6d854","#ffd92f","#e5c494","#b3b3b3"],Accent:["#7fc97f","#beaed4","#fdc086","#ffff99","#386cb0","#f0027f","#bf5b17","#666666"],Set1:["#e41a1c","#377eb8","#4daf4a","#984ea3","#ff7f00","#ffff33","#a65628","#f781bf","#999999"],Set3:["#8dd3c7","#ffffb3","#bebada","#fb8072","#80b1d3","#fdb462","#b3de69","#fccde5","#d9d9d9","#bc80bd","#ccebc5","#ffed6f"],Dark2:["#1b9e77","#d95f02","#7570b3","#e7298a","#66a61e","#e6ab02","#a6761d","#666666"],Paired:["#a6cee3","#1f78b4","#b2df8a","#33a02c","#fb9a99","#e31a1c","#fdbf6f","#ff7f00","#cab2d6","#6a3d9a","#ffff99","#b15928"],Pastel2:["#b3e2cd","#fdcdac","#cbd5e8","#f4cae4","#e6f5c9","#fff2ae","#f1e2cc","#cccccc"],Pastel1:["#fbb4ae","#b3cde3","#ccebc5","#decbe4","#fed9a6","#ffffcc","#e5d8bd","#fddaec","#f2f2f2"]},of=0,uf=Object.keys(ff);of<uf.length;of+=1){var cf=uf[of];ff[cf.toLowerCase()]=ff[cf]}var lf=ff,hf=y;return hf.average=function(r,e,n){void 0===e&&(e="lrgb"),void 0===n&&(n=null);var t=r.length;n||(n=Array.from(new Array(t)).map((function(){return 1})));var a=t/n.reduce((function(r,e){return r+e}));if(n.forEach((function(r,e){n[e]*=a})),r=r.map((function(r){return new ta(r)})),"lrgb"===e)return ha(r,n);for(var f=r.shift(),o=f.get(e),u=[],c=0,i=0,l=0;l<o.length;l++)if(o[l]=(o[l]||0)*n[0],u.push(isNaN(o[l])?0:n[0]),"h"===e.charAt(l)&&!isNaN(o[l])){var h=o[l]/180*ua;c+=ca(h)*n[0],i+=ia(h)*n[0]}var s=f.alpha()*n[0];r.forEach((function(r,t){var a=r.get(e);s+=r.alpha()*n[t+1];for(var f=0;f<o.length;f++)if(!isNaN(a[f]))if(u[f]+=n[t+1],"h"===e.charAt(f)){var l=a[f]/180*ua;c+=ca(l)*n[t+1],i+=ia(l)*n[t+1]}else o[f]+=a[f]*n[t+1]}));for(var d=0;d<o.length;d++)if("h"===e.charAt(d)){for(var b=la(i/u[d],c/u[d])/ua*180;b<0;)b+=360;for(;b>=360;)b-=360;o[d]=b}else o[d]=o[d]/u[d];return s/=t,new ta(o,e).alpha(s>.99999?1:s,!0)},hf.bezier=function(r){var e=function(r){var e,n,t,a,f,o,u;if(2===(r=r.map((function(r){return new va(r)}))).length)e=r.map((function(r){return r.lab()})),f=e[0],o=e[1],a=function(r){var e=[0,1,2].map((function(e){return f[e]+r*(o[e]-f[e])}));return new va(e,"lab")};else if(3===r.length)n=r.map((function(r){return r.lab()})),f=n[0],o=n[1],u=n[2],a=function(r){var e=[0,1,2].map((function(e){return(1-r)*(1-r)*f[e]+2*(1-r)*r*o[e]+r*r*u[e]}));return new va(e,"lab")};else if(4===r.length){var c;t=r.map((function(r){return r.lab()})),f=t[0],o=t[1],u=t[2],c=t[3],a=function(r){var e=[0,1,2].map((function(e){return(1-r)*(1-r)*(1-r)*f[e]+3*(1-r)*(1-r)*r*o[e]+3*(1-r)*r*r*u[e]+r*r*r*c[e]}));return new va(e,"lab")}}else{if(!(r.length>=5))throw new RangeError("No point in running bezier with only one color.");var i,l,h;i=r.map((function(r){return r.lab()})),h=r.length-1,l=function(r){for(var e=[1,1],n=1;n<r;n++){for(var t=[1],a=1;a<=e.length;a++)t[a]=(e[a]||0)+e[a-1];e=t}return e}(h),a=function(r){var e=1-r,n=[0,1,2].map((function(n){return i.reduce((function(t,a,f){return t+l[f]*Math.pow(e,h-f)*Math.pow(r,f)*a[n]}),0)}));return new va(n,"lab")}}return a}(r);return e.scale=function(){return ma(e)},e},hf.blend=Na,hf.cubehelix=function(r,e,n,t,a){void 0===r&&(r=300),void 0===e&&(e=-1.5),void 0===n&&(n=1),void 0===t&&(t=1),void 0===a&&(a=[0,1]);var f,o=0;"array"===_a(a)?f=a[1]-a[0]:(f=0,a=[a,a]);var u=function(u){var c=Aa*((r+120)/360+e*u),i=Ea(a[0]+f*u,t),l=(0!==o?n[0]+u*o:n)*i*(1-i)/2,h=Pa(c),s=Fa(c);return Oa(xa([255*(i+l*(-.14861*h+1.78277*s)),255*(i+l*(-.29227*h-.90649*s)),255*(i+l*(1.97294*h)),1]))};return u.start=function(e){return null==e?r:(r=e,u)},u.rotations=function(r){return null==r?e:(e=r,u)},u.gamma=function(r){return null==r?t:(t=r,u)},u.hue=function(r){return null==r?n:("array"===_a(n=r)?0===(o=n[1]-n[0])&&(n=n[1]):o=0,u)},u.lightness=function(r){return null==r?a:("array"===_a(r)?(a=r,f=r[1]-r[0]):(a=[r,r],f=0),u)},u.scale=function(){return Oa.scale(u)},u.hue(n),u},hf.mix=hf.interpolate=Rt,hf.random=function(){for(var r="#",e=0;e<6;e++)r+="0123456789abcdef".charAt(Ga(16*Ra()));return new ja(r,"hex")},hf.scale=pa,hf.analyze=Sa.analyze,hf.contrast=function(r,e){r=new Ta(r),e=new Ta(e);var n=r.luminance(),t=e.luminance();return n>t?(n+.05)/(t+.05):(t+.05)/(n+.05)},hf.deltaE=function(r,e,n,t,a){void 0===n&&(n=1),void 0===t&&(t=1),void 0===a&&(a=1);var f=function(r){return 360*r/(2*Qa)},o=function(r){return 2*Qa*r/360};r=new $a(r),e=new $a(e);var u=Array.from(r.lab()),c=u[0],i=u[1],l=u[2],h=Array.from(e.lab()),s=h[0],d=h[1],b=h[2],p=(c+s)/2,g=(za(Xa(i,2)+Xa(l,2))+za(Xa(d,2)+Xa(b,2)))/2,v=.5*(1-za(Xa(g,7)/(Xa(g,7)+Xa(25,7)))),m=i*(1+v),y=d*(1+v),k=za(Xa(m,2)+Xa(l,2)),w=za(Xa(y,2)+Xa(b,2)),M=(k+w)/2,N=f(Wa(l,m)),_=f(Wa(b,y)),x=N>=0?N:N+360,A=_>=0?_:_+360,E=Ka(x-A)>180?(x+A+360)/2:(x+A)/2,F=1-.17*Za(o(E-30))+.24*Za(o(2*E))+.32*Za(o(3*E+6))-.2*Za(o(4*E-63)),P=A-x;P=Ka(P)<=180?P:A<=x?P+360:P-360,P=2*za(k*w)*Ha(o(P)/2);var O=s-c,j=w-k,G=1+.015*Xa(p-50,2)/za(20+Xa(p-50,2)),R=1+.045*M,q=1+.015*M*F,L=30*Ja(-Xa((E-275)/25,2)),I=-(2*za(Xa(M,7)/(Xa(M,7)+Xa(25,7))))*Ha(2*o(L)),B=za(Xa(O/(n*G),2)+Xa(j/(t*R),2)+Xa(P/(a*q),2)+I*(j/(t*R))*(P/(a*q)));return Va(0,Ua(100,B))},hf.distance=function(r,e,n){void 0===n&&(n="lab"),r=new rf(r),e=new rf(e);var t=r.get(n),a=e.get(n),f=0;for(var o in t){var u=(t[o]||0)-(a[o]||0);f+=u*u}return Math.sqrt(f)},hf.limits=Sa.limits,hf.valid=function(){for(var r=[],e=arguments.length;e--;)r[e]=arguments[e];try{return new(Function.prototype.bind.apply(ef,[null].concat(r))),!0}catch(r){return!1}},hf.scales=af,hf.colors=sn,hf.brewer=lf,hf}));
