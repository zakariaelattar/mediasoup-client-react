import './App.css';
//index.js
import OneToOne from './OneToOne';
import Conference from './Conference';


const isConference = window.location.search.split('?')[1].split('=')[1];
console.log(isConference == 'true')
function App(props) {



 return (isConference == "true" ?<Conference  />:<OneToOne />)
}

export default App;
