/** Keep fixture callbacks attached to the current page of their original context.
 * A captured Page becomes permanently closed after a user closes its window.
 * This facade resolves each call again, so clock updates and screenshots follow
 * a reopened page while context-level wallet bindings/storage remain untouched.
 */
export function followContextPage(context){
  return new Proxy({}, {get(_target,key){
    if(key==='context')return ()=>context
    const page=context.pages().filter(page=>!page.isClosed()).at(-1)
    if(!page)throw Error('Test browser is closed. Reopen the same test browser first.')
    const value=page[key]
    return typeof value==='function'?value.bind(page):value
  }})
}
