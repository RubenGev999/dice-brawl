import './style.css'
import { startApp } from './ui/app.ts'

const root = document.getElementById('app')
if (!root) throw new Error('#app not found')
startApp(root)
