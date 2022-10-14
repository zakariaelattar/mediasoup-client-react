import logo from './logo.svg';
import './App.css';
//index.js
import io from "socket.io-client"
import mediasoupClient, { Device } from 'mediasoup-client'
import { useEffect } from 'react';

const socket = io("https://chat.tifos.net/mediasoup", {
    auth: { token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjYsInVzZXJuYW1lIjoiQWhtZWQxNjY1NCIsIm5hbWUiOiJBaG1lZDE2NjU0IiwibWVkaWEiOm51bGwsImlhdCI6MTY2NTQxMDA4MSwiZXhwIjoxNjY1NDIwODgxLCJ0eXBlIjoiYWNjZXNzIn0.cknPdjlk0ui_D_VQJDe0t1ELF-apWSWRTFEcxJBV37I" }

})
function App() {
    useEffect(() => {
        console.log("connecting to server ...")
        socket.on('connection-success', ({ socketId }) => {
            console.log(socketId)
        })

    }, [])




    let device
    let rtpCapabilities
    let producerTransport
    let consumerTransport
    let producer
    let consumer

    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerOptions
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
    let params = {
        // mediasoup params
        encodings: [{
            rid: 'r0',
            maxBitrate: 100000,
            scalabilityMode: 'S1T3',
        },
        {
            rid: 'r1',
            maxBitrate: 300000,
            scalabilityMode: 'S1T3',
        },
        {
            rid: 'r2',
            maxBitrate: 900000,
            scalabilityMode: 'S1T3',
        },
        ],
        // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
        codecOptions: {
            videoGoogleStartBitrate: 1000
        }
    }
    var ss;
    const streamSuccess = async (stream) => {
        var localVideo = document.getElementById('localVideo');
        localVideo.srcObject = stream;
        ss = stream;
        localVideo.onloadedmetadata = function (e) {
            console.log('loaded meta');

            localVideo.play();
        };
        const track = stream.getVideoTracks()[0]
        params = {
            track,
            ...params
        }

        console.log(stream);
    }

    const getLocalStream = () => {
        navigator.getUserMedia({
            audio: true,
            video: {
                width: {
                    min: 640,
                    max: 1920,
                },
                height: {
                    min: 400,
                    max: 1080,
                }
            }
        }, streamSuccess, error => {
            console.log(error.message)
        })
    }

    // A device is an endpoint connecting to a Router on the 
    // server side to send/recive media
    const createDevice = async () => {
        console.log('creating device');
        try {
            device = new Device

            // https://mediasoup.org/documentation/v3/mediasoup-client/api/#device-load
            // Loads the device with RTP capabilities of the Router (server side)
            await device.load({
                // see getRtpCapabilities() below
                routerRtpCapabilities: rtpCapabilities
            })

            console.log('RTP Capabilities', device.rtpCapabilities)

        } catch (error) {
            console.log(error)
            if (error.name === 'UnsupportedError')
                console.warn('browser not supported')
        }
    }

    const getRtpCapabilities = () => {
        console.log('getting rtp capabilities');
        // make a request to the server for Router RTP Capabilities
        // see server's socket.on('getRtpCapabilities', ...)
        // the server sends back data object which contains rtpCapabilities
        socket.emit('getRtpCapabilities', (data) => {
            console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`)

            // we assign to local variable and will be used when
            // loading the client Device (see createDevice above)
            rtpCapabilities = data.rtpCapabilities
        })
    }

    const createSendTransport = () => {
        // see server's socket.on('createWebRtcTransport', sender?, ...)
        // this is a call from Producer, so sender = true
        socket.emit('createWebRtcTransportSend', ({ params }) => {
            // The server sends back params needed 
            // to create Send Transport on the client side
            if (params.error) {
                console.log(params.error)
                return
            }


            // creates a new WebRTC Transport to send media
            // based on the server's producer transport params
            // https://mediasoup.org/documentation/v3/mediasoup-client/api/#TransportOptions
            producerTransport = device.createSendTransport(params)

            // https://mediasoup.org/documentation/v3/communication-between-client-and-server/#producing-media
            // this event is raised when a first call to transport.produce() is made
            // see connectSendTransport() below
            producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
                try {
                    console.log('++++++++++++++++++++++++++++++++++++++>')
                    // Signal local DTLS parameters to the server side transport
                    // see server's socket.on('transport-connect', ...)
                    await socket.emit('transport-connect', {
                        dtlsParameters,
                    })

                    // Tell the transport that parameters were transmitted.
                    callback()

                } catch (error) {
                    errback(error)
                }
            })

            producerTransport.on('produce', async (parameters, callback, errback) => {

                try {
                    // tell the server to create a Producer
                    // with the following parameters and produce
                    // and expect back a server side producer id
                    // see server's socket.on('transport-produce', ...)
                    await socket.emit('transport-produce', {
                        kind: parameters.kind,
                        rtpParameters: parameters.rtpParameters,
                        appData: parameters.appData,
                    }, ({ id }) => {
                        // Tell the transport that parameters were transmitted and provide it with the
                        // server side producer's id.
                        callback({ id })
                    })
                } catch (error) {
                    errback(error)
                }
            })
        })
    }

    const connectSendTransport = async () => {
        // we now call produce() to instruct the producer transport
        // to send media to the Router
        // https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
        // this action will trigger the 'connect' and 'produce' events above
        producer = await producerTransport.produce(params)
        producer.on('trackended', () => {
            console.log('track ended')

            // close video track
        })

        producer.on('transportclose', () => {
            console.log('transport ended')

            // close video track
        })
    }

    const createRecvTransport = async () => {
        console.log('creating receiver transport')
        // see server's socket.on('consume', sender?, ...)
        // this is a call from Consumer, so sender = false
        await socket.emit('createWebRtcTransportRcv', ({ params }) => {
            // The server sends back params needed 
            // to create Send Transport on the client side
            if (params.error) {
                console.log(params.error)
                return
            }

            console.log(params)

            // creates a new WebRTC Transport to receive media
            // based on server's consumer transport params
            // https://mediasoup.org/documentation/v3/mediasoup-client/api/#device-createRecvTransport
            consumerTransport = device.createRecvTransport(params)

            // https://mediasoup.org/documentation/v3/communication-between-client-and-server/#producing-media
            // this event is raised when a first call to transport.produce() is made
            // see connectRecvTransport() below
            consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
                console.log('transport sent the event connect')
                try {
                    // Signal local DTLS parameters to the server side transport
                    // see server's socket.on('transport-recv-connect', ...)
                    await socket.emit('transport-recv-connect', {
                        dtlsParameters,
                    })

                    // Tell the transport that parameters were transmitted.
                    callback()
                } catch (error) {
                    // Tell the transport that something was wrong
                    errback(error)
                }
            })
        })
    }

    const connectRecvTransport = async () => {
        // for consumer, we need to tell the server first
        // to create a consumer based on the rtpCapabilities and consume
        // if the router can consume, it will send back a set of params as below
        await socket.emit('consume', {
            rtpCapabilities: device.rtpCapabilities,
        }, async ({ params }) => {
            if (params.error) {
                console.log('Cannot Consume')
                return
            }

            console.log(params)
            // then consume with the local consumer transport
            // which creates a consumer
            consumer = await consumerTransport.consume({
                id: params.id,
                producerId: params.producerId,
                kind: params.kind,
                rtpParameters: params.rtpParameters
            })

            // destructure and retrieve the video track from the producer
            const { track } = consumer

            console.log(consumer);
            const stream = new MediaStream();
            stream.addTrack(track);

            console.log('its video')
            const video = document.createElement('video');
            video.setAttribute('style', 'width: 400px; heigth:400px');
            video.setAttribute('playsinline', '');
            console.log(stream);
            video.srcObject = stream;
            document.getElementById('container').appendChild(video);
            video.play();


            // the server consumer started with media paused
            // so we need to inform the server to resume
            socket.emit('consumer-resume')


        })
    }

    return (
        <div className="App">
            <div id="video">
                <table>
                    <thead>
                        <th>Local Video</th>
                        <th>Remote Video</th>
                    </thead>
                    <tbody>
                        <tr>
                            <td>
                                <div id="sharedBtns">
                                    <video id="localVideo" class="video"></video>
                                </div>
                            </td>
                            <td>
                                <div id="container">

                                </div>
                                {/* <div id="sharedBtns">
                                <video id="remoteVideo" autoPlay class="video"></video>
                            </div> */}
                            </td>
                        </tr>
                        <tr>
                            <td>
                                <div id="sharedBtns">
                                    <button id="btnLocalVideo" onClick={getLocalStream} >1. Get Local Video</button>
                                </div>
                            </td>
                        </tr>
                        <tr>
                            <td colspan="2">
                                <div id="sharedBtns">
                                    <button id="btnRtpCapabilities" onClick={getRtpCapabilities}>2. Get Rtp Capabilities</button>
                                    <br />
                                    <button id="btnDevice" onClick={createDevice}>3. Create Device</button>
                                </div>
                            </td>
                        </tr>
                        <tr>
                            <td>
                                <div id="sharedBtns">
                                    <button id="btnCreateSendTransport" onClick={createSendTransport}>4. Create Send Transport</button>
                                    <br />
                                    <button id="btnConnectSendTransport" onClick={connectSendTransport}>5. Connect Send Transport & Produce</button>
                                </div>
                            </td>
                            <td>
                                <div id="sharedBtns">
                                    <button id="btnRecvSendTransport" onClick={createRecvTransport}>6. Create Recv Transport</button>
                                    <br />
                                    <button id="btnConnectRecvTransport" onClick={connectRecvTransport}>7. Connect Recv Transport & Consume</button>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default App;
