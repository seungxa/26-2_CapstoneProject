document.getElementById('search').onclick=()=>{
  const results=document.getElementById('results');results.replaceChildren();const button=document.createElement('button');button.type='button';button.textContent=document.getElementById('query').value;
  button.onclick=()=>{if(window.opener){window.opener.document.getElementById('zip').value='00000';window.opener.document.getElementById('base-address').value=button.textContent;}window.close();};results.append(button);
};
