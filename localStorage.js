let windowb = window.open('', '', 'top=0,left=0,width=1,height=1')
window.dispatchEvent(new Event('beforeunload'))
let localStorage = JSON.parse(JSON.stringify(windowb.localStorage))
windowb.close()

console.log(localStorage)

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    sendResponse({result: localStorage[request.localStorage]})
})