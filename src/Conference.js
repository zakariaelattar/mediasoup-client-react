import logo from './logo.svg';
import './App.css';
//index.js
import io from "socket.io-client"
import mediasoupClient, { Device } from 'mediasoup-client'
import { useEffect, useState } from 'react';


const roomName = window.location.pathname.split('/')[3]

// const socket = io("/mediasoup")
let socket;


export default function Conference(props) {

  let localVideo;
  let handleInviteClick;

  const [token, setToken] = useState('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjEzLCJ1c2VybmFtZSI6IlJleTE2NjcwIiwibmFtZSI6IlJleTE2NjcwIiwibWVkaWEiOm51bGwsImlhdCI6MTY2NzAwNzI0OCwiZXhwIjoxNjY3MDE4MDQ4LCJ0eXBlIjoiYWNjZXNzIn0.sVHiLa0o1A2Ytf2EcnYXUT08y5SyytJhfRU_4pKbFBs');
  const [speakerId, setSpeakerId] = useState(null);
  const [roomId, setRoomId] = useState(1);

  useEffect(() => {
    localVideo = document.getElementById('localVideo');





  }, [])


  const handleTokenChange = (e) => {
    setToken(e.target.value);
  }

  const handleRoomIdChange = (e) => {
    setRoomId(e.target.value)
  }


  const handleSpeakerIdChange = (e) => {
    setSpeakerId(e.target.value);
  }

  const handleJoinClick = () => {
    console.log("connecting");
    socket = io("https://chat.tifos.net/", {
      auth: { token }

    })
    socket.connect();

    socket.on('connection-success', ({ socketId }) => {
      console.log(socketId)
      joinConference();
    })

    let device
    let rtpCapabilities
    let producerTransport
    let consumerTransports = []
    let audioProducer
    let videoProducer
    let consumer
    let isProducer = false

    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerOptions
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
    let params = {
      // mediasoup params
      encodings: [
        {
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

    let audioParams;
    let videoParams = { params };
    let consumingTransports = [];
    let handleInviteClick;


    const streamSuccess = async (stream) => {
      var localVideo = document.getElementById('localVideo');
      localVideo.srcObject = stream;
      localVideo.onloadedmetadata = function (e) {
        console.log('loaded meta');

        localVideo.play();
      };


      console.log(stream);
      audioParams = { track: stream.getAudioTracks()[0], ...audioParams };
      videoParams = { track: stream.getVideoTracks()[0], ...videoParams };
      joinConference()

    }


    const joinConference = () => {
      socket.emit('join-conference', { roomName }, (data) => {
        console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`)
        // we assign to local variable and will be used when
        // loading the client Device (see createDevice above)
        rtpCapabilities = data.rtpCapabilities

        // once we have rtpCapabilities from the Router, create Device
        createDevice()
      })
    }

    const getLocalStream = () => {
      navigator.mediaDevices.getUserMedia({
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
      })
        .then(streamSuccess)
        .catch(error => {
          console.log(error.message)
        })
    }

    // A device is an endpoint connecting to a Router on the
    // server side to send/recive media
    const createDevice = async () => {
      try {
        device = new Device

        // https://mediasoup.org/documentation/v3/mediasoup-client/api/#device-load
        // Loads the device with RTP capabilities of the Router (server side)
        await device.load({
          // see getRtpCapabilities() below
          routerRtpCapabilities: rtpCapabilities
        })

        console.log('Device RTP Capabilities', device.rtpCapabilities)

        // once the device loads, create transport
        createSendTransport()

      } catch (error) {
        console.log(error)
        if (error.name === 'UnsupportedError')
          console.warn('browser not supported')
      }
    }

    const createSendTransport = () => {
      // see server's socket.on('createWebRtcTransport', sender?, ...)
      // this is a call from Producer, so sender = true
      socket.emit('createWebRtcTransport', { consumer: false }, ({ params }) => {
        // The server sends back params needed 
        // to create Send Transport on the client side
        if (params.error) {
          console.log(params.error)
          return
        }

        console.log(params)

        // creates a new WebRTC Transport to send media
        // based on the server's producer transport params
        // https://mediasoup.org/documentation/v3/mediasoup-client/api/#TransportOptions
        producerTransport = device.createSendTransport(params)

        // https://mediasoup.org/documentation/v3/communication-between-client-and-server/#producing-media
        // this event is raised when a first call to transport.produce() is made
        // see connectSendTransport() below
        producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
          try {
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
          console.log(parameters)

          try {
            // tell the server to create a Producer
            // with the following parameters and produce
            // and expect back a server side producer id
            // see server's socket.on('transport-produce', ...)
            await socket.emit('transport-produce', {
              kind: parameters.kind,
              rtpParameters: parameters.rtpParameters,
              appData: parameters.appData,
            }, ({ id, producersExist }) => {
              // Tell the transport that parameters were transmitted and provide it with the
              // server side producer's id.
              callback({ id })

              // if producers exist, then join room
              if (producersExist) getProducers()
            })
          } catch (error) {
            errback(error)
          }
        })

        connectSendTransport()
      })
    }

    const connectSendTransport = async () => {
      // we now call produce() to instruct the producer transport
      // to send media to the Router
      // https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
      // this action will trigger the 'connect' and 'produce' events above

      audioProducer = await producerTransport.produce(audioParams);
      videoProducer = await producerTransport.produce(videoParams);

      audioProducer.on('trackended', () => {
        console.log('audio track ended')

        // close audio track
      })

      audioProducer.on('transportclose', () => {
        console.log('audio transport ended')

        // close audio track
      })

      videoProducer.on('trackended', () => {
        console.log('video track ended')

        // close video track
      })

      videoProducer.on('transportclose', () => {
        console.log('video transport ended')

        // close video track
      })
    }

    const signalNewConsumerTransport = async (remoteProducerId) => {
      //check if we are already consuming the remoteProducerId
      if (consumingTransports.includes(remoteProducerId)) return;
      consumingTransports.push(remoteProducerId);

      await socket.emit('createWebRtcTransport', { consumer: true }, ({ params }) => {
        // The server sends back params needed 
        // to create Send Transport on the client side
        if (params.error) {
          console.log(params.error)
          return
        }
        console.log(`PARAMS... ${params}`)

        let consumerTransport
        try {
          consumerTransport = device.createRecvTransport(params)
        } catch (error) {
          // exceptions: 
          // {InvalidStateError} if not loaded
          // {TypeError} if wrong arguments.
          console.log(error)
          return
        }

        consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
          try {
            // Signal local DTLS parameters to the server side transport
            // see server's socket.on('transport-recv-connect', ...)
            await socket.emit('transport-recv-connect', {
              dtlsParameters,
              serverConsumerTransportId: params.id,
            })

            // Tell the transport that parameters were transmitted.
            callback()
          } catch (error) {
            // Tell the transport that something was wrong
            errback(error)
          }
        })

        connectRecvTransport(consumerTransport, remoteProducerId, params.id)
      })
    }

    // server informs the client of a new producer just joined
    socket.on('new-producer', ({ producerId }) => signalNewConsumerTransport(producerId))

    const getProducers = () => {
      socket.emit('getProducers', producerIds => {
        console.log(producerIds)
        // for each of the producer create a consumer
        // producerIds.forEach(id => signalNewConsumerTransport(id))
        producerIds.forEach(signalNewConsumerTransport)
      })
    }

    const connectRecvTransport = async (consumerTransport, remoteProducerId, serverConsumerTransportId) => {
      // for consumer, we need to tell the server first
      // to create a consumer based on the rtpCapabilities and consume
      // if the router can consume, it will send back a set of params as below
      await socket.emit('consume', {
        rtpCapabilities: device.rtpCapabilities,
        remoteProducerId,
        serverConsumerTransportId,
      }, async ({ params }) => {
        if (params.error) {
          console.log('Cannot Consume')
          return
        }

        console.log(`Consumer Params ${params}`)
        // then consume with the local consumer transport
        // which creates a consumer
        const consumer = await consumerTransport.consume({
          id: params.id,
          producerId: params.producerId,
          kind: params.kind,
          rtpParameters: params.rtpParameters
        })

        consumerTransports = [
          ...consumerTransports,
          {
            consumerTransport,
            serverConsumerTransportId: params.id,
            producerId: remoteProducerId,
            consumer,
          },
        ]

        // create a new div element for the new consumer media
        const newElem = document.createElement('div')
        newElem.setAttribute('id', `td-${remoteProducerId}`)

        if (params.kind == 'audio') {
          //append to the audio container
          newElem.innerHTML = '<audio id="' + remoteProducerId + '" autoplay></audio>'
        } else {
          //append to the video container
          newElem.setAttribute('class', 'remoteVideo')
          newElem.innerHTML = '<video id="' + remoteProducerId + '" autoplay class="video" ></video>'
        }

       let videoContainer;

        videoContainer = document.getElementById('videoContainer');

        videoContainer.appendChild(newElem)

        // destructure and retrieve the video track from the producer
        const { track } = consumer

        document.getElementById(remoteProducerId).srcObject = new MediaStream([track])

        // the server consumer started with media paused
        // so we need to inform the server to resume
        socket.emit('consumer-resume', { serverConsumerId: params.serverConsumerId })
      })
    }

    socket.on('producer-closed', ({ remoteProducerId }) => {
      // server notification is received when a producer is closed
      // we need to close the client-side consumer and associated transport
      const producerToClose = consumerTransports.find(transportData => transportData.producerId === remoteProducerId)
      producerToClose.consumerTransport.close()
      producerToClose.consumer.close()

      // remove the consumer transport from the list
      consumerTransports = consumerTransports.filter(transportData => transportData.producerId !== remoteProducerId)

      // remove the video div element
      videoContainer.removeChild(document.getElementById(`td-${remoteProducerId}`))
    })

  }

  handleInviteClick = () => {
    socket.emit('invite-speaker', { speakerId, roomId })
  }
  /**
   * 
   */
  const handleConnectButtonClick = () => {}
  const handleStartClick = () => {
    console.log("connecting");
    socket = io("https://chat.tifos.net/", {
      extraHeaders: {
        authorization: token
      }

    })
    socket.connect();

    socket.on('connection-success', ({ socketId }) => {
      console.log(socketId)
      getLocalStream();
    })

    let device
    let rtpCapabilities
    let producerTransport
    let consumerTransports = []
    let audioProducer
    let videoProducer
    let consumer
    let isProducer = false

    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerOptions
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
    let params = {
      // mediasoup params
      encodings: [
        {
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

    let audioParams;
    let videoParams = { params };
    let consumingTransports = [];


    handleInviteClick = () => {
      socket.emit('invite-speaker', { speakerId })
    }


    const streamSuccess = async (stream) => {
      var localVideo = document.getElementById('localVideo');
      localVideo.srcObject = stream;
      localVideo.onloadedmetadata = function (e) {
        console.log('loaded meta');

        localVideo.play();
      };


      console.log(stream);
      audioParams = { track: stream.getAudioTracks()[0], ...audioParams };
      videoParams = { track: stream.getVideoTracks()[0], ...videoParams };
      createConference()

    }


    const createConference = () => {
      socket.emit('create-conference', { roomName, roomId }, (data) => {
        console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`)
        // we assign to local variable and will be used when
        // loading the client Device (see createDevice above)
        rtpCapabilities = data.rtpCapabilities

        // once we have rtpCapabilities from the Router, create Device
        createDevice()
      })
    }

    const getLocalStream = () => {
      navigator.mediaDevices.getUserMedia({
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
      })
        .then(streamSuccess)
        .catch(error => {
          console.log(error.message)
        })
    }

    // A device is an endpoint connecting to a Router on the
    // server side to send/recive media
    const createDevice = async () => {
      try {
        console.log('+++++++++++++++++++calling the create device')
        device = new Device

        // https://mediasoup.org/documentation/v3/mediasoup-client/api/#device-load
        // Loads the device with RTP capabilities of the Router (server side)
        await device.load({
          // see getRtpCapabilities() below
          routerRtpCapabilities: rtpCapabilities
        })

        console.log('Device RTP Capabilities', device.rtpCapabilities)

        // once the device loads, create transport
        createSendTransport()

      } catch (error) {
        console.log(error)
        if (error.name === 'UnsupportedError')
          console.warn('browser not supported')
      }
    }

    const createSendTransport = () => {
      // see server's socket.on('createWebRtcTransport', sender?, ...)
      // this is a call from Producer, so sender = true
      socket.emit('createWebRtcTransport', { consumer: false }, ({ params }) => {
        // The server sends back params needed 
        // to create Send Transport on the client side
        if (params.error) {
          console.log(params.error)
          return
        }

        console.log(params)

        // creates a new WebRTC Transport to send media
        // based on the server's producer transport params
        // https://mediasoup.org/documentation/v3/mediasoup-client/api/#TransportOptions
        producerTransport = device.createSendTransport(params)

        // https://mediasoup.org/documentation/v3/communication-between-client-and-server/#producing-media
        // this event is raised when a first call to transport.produce() is made
        // see connectSendTransport() below
        producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
          try {
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
          console.log(parameters)

          try {
            // tell the server to create a Producer
            // with the following parameters and produce
            // and expect back a server side producer id
            // see server's socket.on('transport-produce', ...)
            await socket.emit('transport-produce', {
              kind: parameters.kind,
              rtpParameters: parameters.rtpParameters,
              appData: parameters.appData,
            }, ({ id, producersExist }) => {
              // Tell the transport that parameters were transmitted and provide it with the
              // server side producer's id.
              callback({ id })

              // if producers exist, then join room
              if (producersExist) getProducers()
            })
          } catch (error) {
            errback(error)
          }
        })

        connectSendTransport()
      })
    }

    const connectSendTransport = async () => {
      // we now call produce() to instruct the producer transport
      // to send media to the Router
      // https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
      // this action will trigger the 'connect' and 'produce' events above

      audioProducer = await producerTransport.produce(audioParams);
      videoProducer = await producerTransport.produce(videoParams);

      audioProducer.on('trackended', () => {
        console.log('audio track ended')

        // close audio track
      })

      audioProducer.on('transportclose', () => {
        console.log('audio transport ended')

        // close audio track
      })

      videoProducer.on('trackended', () => {
        console.log('video track ended')

        // close video track
      })

      videoProducer.on('transportclose', () => {
        console.log('video transport ended')

        // close video track
      })
    }

    const signalNewConsumerTransport = async (remoteProducerId) => {
      //check if we are already consuming the remoteProducerId
      if (consumingTransports.includes(remoteProducerId)) return;
      consumingTransports.push(remoteProducerId);

      await socket.emit('createWebRtcTransport', { consumer: true }, ({ params }) => {
        // The server sends back params needed 
        // to create Send Transport on the client side
        if (params.error) {
          console.log(params.error)
          return
        }
        console.log(`PARAMS... ${params}`)

        let consumerTransport
        try {
          consumerTransport = device.createRecvTransport(params)
        } catch (error) {
          // exceptions: 
          // {InvalidStateError} if not loaded
          // {TypeError} if wrong arguments.
          console.log(error)
          return
        }

        consumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
          try {
            // Signal local DTLS parameters to the server side transport
            // see server's socket.on('transport-recv-connect', ...)
            await socket.emit('transport-recv-connect', {
              dtlsParameters,
              serverConsumerTransportId: params.id,
            })

            // Tell the transport that parameters were transmitted.
            callback()
          } catch (error) {
            // Tell the transport that something was wrong
            errback(error)
          }
        })

        connectRecvTransport(consumerTransport, remoteProducerId, params.id)
      })
    }

    // server informs the client of a new producer just joined
    socket.on('new-producer', ({ producerId }) => signalNewConsumerTransport(producerId))

    const getProducers = () => {
      socket.emit('get-producers', producerIds => {
        console.log(producerIds)
        // for each of the producer create a consumer
        // producerIds.forEach(id => signalNewConsumerTransport(id))
        producerIds.forEach(signalNewConsumerTransport)
      })
    }



    const connectRecvTransport = async (consumerTransport, remoteProducerId, serverConsumerTransportId) => {
      // for consumer, we need to tell the server first
      // to create a consumer based on the rtpCapabilities and consume
      // if the router can consume, it will send back a set of params as below
      await socket.emit('consume', {
        rtpCapabilities: device.rtpCapabilities,
        remoteProducerId,
        serverConsumerTransportId,
      }, async ({ params }) => {
        if (params.error) {
          console.log('Cannot Consume')
          return
        }

        console.log(`Consumer Params ${params}`)
        // then consume with the local consumer transport
        // which creates a consumer
        const consumer = await consumerTransport.consume({
          id: params.id,
          producerId: params.producerId,
          kind: params.kind,
          rtpParameters: params.rtpParameters
        })

        consumerTransports = [
          ...consumerTransports,
          {
            consumerTransport,
            serverConsumerTransportId: params.id,
            producerId: remoteProducerId,
            consumer,
          },
        ]

        // create a new div element for the new consumer media
        const newElem = document.createElement('div')
        newElem.setAttribute('id', `td-${remoteProducerId}`)

        if (params.kind == 'audio') {
          //append to the audio container
          newElem.innerHTML = '<audio id="' + remoteProducerId + '" autoplay></audio>'
        } else {
          //append to the video container
          newElem.setAttribute('class', 'remoteVideo')
          newElem.innerHTML = '<video id="' + remoteProducerId + '" autoplay class="video" ></video>'
        }

        let videoContainer;

        videoContainer = document.getElementById('videoContainer');
        console.log(videoContainer);
        videoContainer.appendChild(newElem)

        // destructure and retrieve the video track from the producer
        const { track } = consumer

        document.getElementById(remoteProducerId).srcObject = new MediaStream([track])

        // the server consumer started with media paused
        // so we need to inform the server to resume
        socket.emit('consumer-resume', { serverConsumerId: params.serverConsumerId })
      })
    }

    socket.on('producer-closed', ({ remoteProducerId }) => {
      // server notification is received when a producer is closed
      // we need to close the client-side consumer and associated transport
      const producerToClose = consumerTransports.find(transportData => transportData.producerId === remoteProducerId)
      producerToClose.consumerTransport.close()
      producerToClose.consumer.close()

      // remove the consumer transport from the list
      consumerTransports = consumerTransports.filter(transportData => transportData.producerId !== remoteProducerId)

      // remove the video div element
      videoContainer.removeChild(document.getElementById(`td-${remoteProducerId}`))
    })


  }


  return (
    <>
      <div className="container">
        <div className="row">
        <table class="mainTable">
          <tbody>
            <tr>

              <td class="localColumn">
                <video id="localVideo" autoplay class="video" muted ></video>
              </td>
              <td class="remoteColumn">
                <div id="videoContainer"></div>
              </td>
            </tr>
         
          </tbody>
        </table>
        </div>



        <div className="row">
          <div className="col-sm-4">
            <label htmlFor="token">Your token</label>
            <div className="row">
            <input type="text" id="token" className='col-sm-4' onChange={handleTokenChange} />
          {/* <button id="btnLocalVideo"  className='btn btn-primary col-sm-4' onClick={handleConnectButtonClick} >Connect</button> */}

            </div>
          </div>

          <div className="col-sm-4">
          <button id="btnLocalVideo" className='btn btn-primary' onClick={handleStartClick} >Start conference</button>
          </div>

          <div className="col-sm-4">
            <label htmlFor="">Invite speaker</label>
            <div className="row">
          <input type="text" placeholder='speaker id' className='col-sm-3' onChange={handleSpeakerIdChange} />
          <button className='btn btn-primary col-sm-8' onClick={handleInviteClick}>invite speaker</button>

            </div>
            
          </div>

          <div className="col-sm-4">
            <label htmlFor="">Tifo ID</label>
            <div className="row">
          <input type="text" onChange={handleRoomIdChange} placeholder='Tifo id' className='col-sm-3' />

            </div>
            
          </div>
        </div>
      </div>


    

    </>
  )

}
