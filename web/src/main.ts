// Agent Kanban - A Kanban-based issue management system for AI agent teams.
// Copyright (c) 2026
// Licensed under the GNU General Public License v3.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//     https://www.gnu.org/licenses/gpl-3.0.html
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import './styles.css';
import './assets/common.css';
import App from './App.vue';
import router from './router.js';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
