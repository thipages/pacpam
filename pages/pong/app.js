import './pong-instance.js'

const testMode = new URLSearchParams(location.search).has('test')

if (testMode) {
  const appId = 'pacpam-pong-' + Math.random().toString(36).slice(2, 10)

  const wrapper = document.createElement('div')
  wrapper.className = 'split'

  const peerA = document.createElement('pong-instance')
  peerA.setAttribute('pseudo', 'PEER-A')
  peerA.setAttribute('app-id', appId)

  const peerB = document.createElement('pong-instance')
  peerB.setAttribute('pseudo', 'PEER-B')
  peerB.setAttribute('app-id', appId)

  wrapper.append(peerA, peerB)
  document.body.appendChild(wrapper)

  // Cross-wire : quand A a son ID, B le reçoit (et vice-versa)
  peerA.addEventListener('id-ready', (e) => {
    peerB.remotePeerId = e.detail.id
  })

  peerB.addEventListener('id-ready', (e) => {
    peerA.remotePeerId = e.detail.id
  })

  // Pré-remplir uniquement pseudo et mot de passe
  const fill = (el, ref, val) => {
    const input = el.querySelector(`[data-ref="${ref}"]`)
    if (input) input.value = val
  }

  fill(peerA, 'password', 'test')
  fill(peerB, 'password', 'test')

} else {
  const instance = document.createElement('pong-instance')
  document.body.appendChild(instance)
}
