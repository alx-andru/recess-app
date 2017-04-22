import {Injectable, EventEmitter} from '@angular/core';
import {AuthProviders, AngularFire, FirebaseAuthState, AuthMethods} from 'angularfire2';
import {UUID} from 'angular2-uuid';
import {Http} from '@angular/http';

import {DataService} from "./data.service";
import {HealthService} from "./health.service";

import * as firebase from 'firebase';
import * as faker from 'faker';

@Injectable()
export class AuthProvider {
  private authState: FirebaseAuthState;
  public onAuth: EventEmitter<FirebaseAuthState> = new EventEmitter();

  public credentials: any;

  constructor(private af: AngularFire,
              private data: DataService,
              private health: HealthService,
              private http: Http) {

    this.data = data;
    this.af.auth.subscribe((state: FirebaseAuthState) => {
      console.log('Firebase auth state:', state);
      this.authState = state;
      this.onAuth.emit(state);

      this.data.monitorConfig();
      //this.data.refreshPush();
    });

  }

  isAuthenticated() {
    console.log(this.authState);
    return this.authState;
  }

  loginWithEmail(credentials) {
    this.af.auth.login(credentials, {
      provider: AuthProviders.Password,
      method: AuthMethods.Password
    }).then((authData) => {
      console.log(authData);

      // update verison
      this.data.updateAppVersion();


    }).catch((error) => {
      console.error(error);

      if (error['code'] === 'auth/user-not-found') {
        this.registerUser();
      }

    });

  }


  registerUser() {
    // random username + password
    this.credentials = {
      email: `${UUID.UUID()}@recess-app.study`,
      password: UUID.UUID(),
    };

    this.af.auth.createUser(this.credentials).then(authData => {
      // augment information
      this.credentials.uid = authData.uid;
      this.credentials.type = 'participant';
      this.credentials.alias = faker.name.firstName();
      this.credentials.createdAt = firebase.database.ServerValue.TIMESTAMP;
      this.data.initUser(this.credentials);

    }).catch(error => {
      console.log(error);
    });

  }

  logout() {
    this.af.auth.logout();
  }

  get currentUser(): string {
    return this.authState ? this.authState.auth.email : '';
  }

  loginOrCreateUser() {

    this.data.getUser().then(user => {
      console.log(user);
      console.log(this.af.auth);
      // create user
      if (null === user) {


        this.registerUser();


        // login
      } else {
        /*
         const credentials = ({
         email: 'test@teste.g0g',
         password: 'testee'
         }); //Added next lines
         this.loginWithEmail(credentials);
         */
        this.loginWithEmail(user);
      }


    }).catch(error => {
      console.error(error)
      this.data.log(error, 105);
    });


  }
}
