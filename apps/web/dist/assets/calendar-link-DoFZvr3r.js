import{c}from"./E-Kalinga_Logo-IT379t6n.js";/**
 * @license lucide-react v1.67.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const n={name:"calendar-plus",size:24,node:[["path",{d:"M16 18h6",key:"987eiv"}],["path",{d:"M16 2v3",key:"otl347"}],["path",{d:"M19 15v6",key:"10aioa"}],["path",{d:"M21 11.5V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h8.3",key:"jgwkxf"}],["path",{d:"M3 9h18",key:"1pudct"}],["path",{d:"M8 2v3",key:"1ioesn"}]]};n.node;const m=c(n),i={morning:"Morning",afternoon:"Afternoon",any:"Any time"};function d(e){return e.replace(/-/g,"")}function s(e){const[t,r,o]=e.split("-").map(Number),a=new Date(t,r-1,o+1);return`${a.getFullYear()}${String(a.getMonth()+1).padStart(2,"0")}${String(a.getDate()).padStart(2,"0")}`}function p(e){return`https://calendar.google.com/calendar/render?${new URLSearchParams({action:"TEMPLATE",text:`${e.serviceName} visit (HealthCentria)`,dates:`${d(e.day)}/${s(e.day)}`,details:[`Confirmed ${e.serviceName} appointment at the health center.`,`Preferred time: ${i[e.timePreference]}.`,"Manage or cancel it in HealthCentria under My Appointments."].join(`
`)}).toString()}`}export{m as C,p as g};
